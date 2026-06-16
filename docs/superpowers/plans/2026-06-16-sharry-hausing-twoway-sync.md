# Sharry ⇄ Hausing Two-Way Fault Sync — Implementation Plan

> **For agentic workers:** implement task-by-task (`- [ ]`). Run `verify` / `integration-verify`
> before push and `review` / `integration-review` after the build. Until Sharry + Hausing
> credentials arrive, build and test against **mocked `fetch`** (mock mode). This plan was revised
> after a fresh-eyes plan review — see the spec §9.

**Goal:** Residents file faults in Sharry's native Service Tickets; a Cloudflare sync mirrors each
to a Hausing General Ticket (with photos) and pushes Hausing status/resolution back into the Sharry
ticket as a message + status, so the resident sees progress in-app. Two-way, polling, idempotent.

**Architecture:** `functions/api/sync/ingress.ts` (Sharry→Hausing) + `functions/api/sync/egress.ts`
(Hausing→Sharry) — **separate invocations** for subrequest/rate budget. Clients:
`functions/api/_sharry.ts` (new) + `functions/api/_hausing.ts` (reused). D1 `fault_reports` holds the
mapping/audit; `sync_state` caches the Sharry access token. External scheduler triggers both with
`SYNC_SECRET`.

**Spec:** [docs/superpowers/specs/2026-06-16-sharry-hausing-twoway-sync-design.md](../specs/2026-06-16-sharry-hausing-twoway-sync-design.md)
**Supersedes:** the WebView fault-relay plan/spec (same date).
**Migration required:** YES (`migrations/0004_sharry_sync.sql`). Apply `--local` then `--remote`.

> ⚠️ **Blocked on access** for live work: Sharry `Application-token` + admin account, and Hausing
> keys. All build/verify tasks run in **mock mode** without them.

---

## What is reused (do NOT rebuild)
`functions/api/_hausing.ts` (createGeneralTicket, getGeneralTicket, `uploadTicketPhoto` + 3-step file
flow, terminal-status set), the D1 audit/rate-limit pattern from `park.ts`, the admin log endpoint,
and **all** `.cursor/skills/`.

## What is removed
`teata-veast/` (form + app.js + SETUP), `functions/api/fault.ts`, `functions/api/fault/status.ts`,
`functions/api/hausing-webhook.ts` (its polling logic moves into `sync/egress.ts`), the
`teata-veast` route in `_redirects`, and the old `POLL_SECRET` + its external scheduler.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `docs/integrations/SHARRY_API.md` | create | Sharry Service Tickets API reference (auth, endpoints, models, limits, the §8 open questions) |
| `docs/integrations/sharry-collection.json` | create | Pinned copy of the Postman collection |
| `docs/integrations/SHARRY_INTEGRATION.md` | rewrite | Replace WebView narrative with the Service Tickets sync model |
| `.cursor/skills/sharry-api/SKILL.md` | create | Agent guide for calling Sharry (mirror `hausing-api` skill) |
| `migrations/0004_sharry_sync.sql` | create | `fault_reports` sync columns + **partial** UNIQUE index + `sync_state` table |
| `functions/api/_sharry.ts` | create | Sharry client: token auth (D1-cached + refresh), list/show, downloadFile, patchStatus, sendMessage |
| `functions/api/_sharry.test.ts` | create | Unit tests (mocked `fetch`): headers, token cache/refresh on 401, list/show parsing, 429 handling |
| `functions/api/sync/ingress.ts` | create | Sharry `new` → claim → Hausing create (+photos) → `processing` |
| `functions/api/sync/egress.ts` | create | Open mapped rows → poll Hausing → message + status to Sharry |
| `functions/api/sync/_sync.test.ts` | create | Sync logic tests (claim-first dedup, idempotent egress) with mocked clients |
| `functions/api/admin/fault-logs.ts` | modify | Surface `sync.*` events (mostly works as-is) |
| `.dev.vars.example` | modify | Add Sharry creds + `SYNC_SECRET`; **remove `POLL_SECRET`** |
| `wrangler.toml` | modify | Add `[vars] SHARRY_API_BASE`; drop `POLL_SECRET` comment |
| `.github/workflows/sync.yml` | create | Scheduler hitting `/api/sync/ingress` + `/api/sync/egress` with `SYNC_SECRET`; **decommission the old `/api/hausing-webhook` schedule** |
| `_redirects`, `README.md`, `docs/ARCHITECTURE.md`, `docs/integrations/HAUSING_API.md`, `.cursor/skills/integration-verify/SKILL.md` | modify | Drop `teata-veast`/`/api/fault`/`POLL_SECRET` references; the `integration-verify` curl example must target `/api/sync/*`, not the deleted `/api/fault` |
| `teata-veast/`, `functions/api/fault.ts`, `functions/api/fault/status.ts`, `functions/api/hausing-webhook.ts` | delete | WebView ingress + standalone poller removed |

---

## Task 0: Pin the Sharry API + access checklist
- [ ] Save the Postman collection to `docs/integrations/sharry-collection.json`.
- [ ] Write `docs/integrations/SHARRY_API.md`: auth (`Application-token` + `Access-token` via
      `POST /token`, grants `admin`/`refresh_token`, TTL ~1 day, `/verify-code` 2FA caveat), HOST =
      `…/api/v8`, the Service Tickets endpoints + **List query params** (`filter[status]`,
      `filter[site_ids][]`, `filter[type]`, `limit`, `offset` — **no time filter**), models
      (`id, identifier, status, description, author{id,fullname,image,company}, files[], solver,
      created_at, updated_at`), the hourly rate limit, and spec §8 open questions.
- [ ] Create the `sharry-api` skill (mirror `hausing-api`).
- [ ] **Access checklist** (send to whoever owns the Sharry account): confirm `grant_type=admin`
      works unattended (no 2FA), the prod/sandbox HOST, the hourly rate-limit number, the `files[]`
      shape, how to get the resident email, and the Rotermann `site_ids`/solver routing.

## Task 1: D1 migration 0004
- [ ] `migrations/0004_sharry_sync.sql`: `ALTER TABLE fault_reports ADD COLUMN sharry_ticket_id TEXT`
      (+ `sharry_identifier`, `sharry_status`, `sharry_status_pushed`, `last_message_pushed`).
- [ ] `CREATE UNIQUE INDEX IF NOT EXISTS idx_fault_reports_sharry_ticket ON fault_reports(sharry_ticket_id) WHERE sharry_ticket_id IS NOT NULL` (**partial**, mirrors the `client_request_id` index).
- [ ] `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)` (token cache).
- [ ] Apply `--local`; verify `PRAGMA table_info(fault_reports)` + the index.

## Task 2: Sharry client `functions/api/_sharry.ts` — TDD
- [ ] `_sharry.test.ts` first (mock `fetch`): sends `Application-token` + `Access-token`; token is
      read from / written to a mocked `sync_state`; **refreshes once on 401** (refresh_token then
      admin) and retries; parses list/show; surfaces `429` (+`Retry-After`) as a typed retryable
      error; defensive non-JSON handling.
- [ ] Implement: `getAccessToken(env)` (D1-cached `{token,refreshToken,expiresAt}`, refresh),
      `listNewTickets(env,{limit,offset})` (`filter[status]=new`), `getTicket(env,id)`,
      `downloadFile(url)` (**bare GET, no auth headers**, returns bytes+content-type, never logs url),
      `patchStatus(env,id,status)`, `sendMessage(env,id,text)`, optional `getUserEmail(env,userId)`.
      Base URL from `env.SHARRY_API_BASE` (includes `/api/v8`).
- [ ] Tests green.

## Task 3: Ingress `functions/api/sync/ingress.ts` (Sharry → Hausing)
- [ ] `SYNC_SECRET` guard; `server_misconfigured` if creds missing.
- [ ] `listNewTickets` (small batch ≈5, `offset` paging). For each ticket:
- [ ] **Claim first:** `INSERT` a `sync.ingress_pending` row with `sharry_ticket_id` (UNIQUE). If the
      insert hits the unique constraint → already claimed/handled → skip (prevents overlapping-run
      duplicates).
- [ ] If claim won: `getTicket` → resolve email best-effort (else omit `watcherEmail`) →
      `createGeneralTicket` (ai-categorized, description = Sharry description) → for each file,
      `downloadFile` then `uploadTicketPhoto` (best-effort) → `UPDATE` row to `sync.ingress_ok`
      (+hausing id/number/status) → `patchStatus(processing)`.
- [ ] On Hausing failure: `UPDATE` row to `sync.ingress_error` (retry policy: pending/error rows
      older than N min are retried; Sharry ticket stays `new`).
- [ ] Honor `429`/`Retry-After`; stop the batch early on repeated upstream failure.

## Task 4: Egress `functions/api/sync/egress.ts` (Hausing → Sharry)
- [ ] `SYNC_SECRET` guard. Select mapped rows **`WHERE event = 'sync.ingress_ok' AND hausing_ticket_id IS NOT NULL AND hausing_status NOT IN (<terminal>)`** (NOT `fault.ok`).
- [ ] `getGeneralTicket` each. On status change: build the Estonian message **per outcome**
      (`DONE`→lahendatud, `NOT_DONE`/`REJECTED`→ei lahendatud/tagasi lükatud) → `sendMessage`
      (guard `last_message_pushed`); if Hausing terminal → `patchStatus(complete)` (guard
      `sharry_status_pushed`); `UPDATE` row. Bounded batch; idempotent on re-run.
- [ ] Log `sync.egress_ok` / `sync.egress_error`.

## Task 5: Remove the WebView flow + retire POLL_SECRET
- [ ] Delete `teata-veast/`, `functions/api/fault.ts`, `functions/api/fault/status.ts`,
      `functions/api/hausing-webhook.ts`.
- [ ] Purge references: `_redirects` (teata-veast route), `README.md`, `docs/ARCHITECTURE.md`,
      `docs/integrations/HAUSING_API.md` (line ~4), `SHARRY_INTEGRATION.md`, `.dev.vars.example`
      (remove `POLL_SECRET`), `wrangler.toml`, and the `integration-verify` skill's `curl /api/fault`
      example (→ `/api/sync/*`). Keep `migrations/0002`/`0003` (history; table reused).

## Task 6: Config + admin + scheduler
- [ ] `.dev.vars.example`: `SHARRY_APP_TOKEN`, `SHARRY_EMAIL`, `SHARRY_PASSWORD` (or `SHARRY_REFRESH_TOKEN`),
      `SHARRY_API_BASE`, `SYNC_SECRET`. `wrangler.toml`: `[vars] SHARRY_API_BASE`.
- [ ] Confirm `/api/admin/fault-logs` shows `sync.*` events.
- [ ] `.github/workflows/sync.yml`: cron (e.g. every 10-15 min) → `curl /api/sync/ingress` and
      `/api/sync/egress` with `SYNC_SECRET`. **Remove the old `/api/hausing-webhook` schedule.**

## Task 7: Verify (mock mode)
- [ ] `npm run typecheck` clean; `npm run test` green (mocked Sharry + Hausing + D1 token cache).
- [ ] `npm run dev` → `curl /api/sync/ingress` + `/api/sync/egress` with the secret → confirm
      graceful behavior with mocked upstreams and D1 rows (pending→ok, idempotent egress). Run
      `integration-review` on the diff.

## Task 8: Live test (DEFERRED — when access arrives)
- [ ] Resolve spec §8 open questions against real data first (email, file shape, solver routing, 2FA,
      cap, host).
- [ ] Sharry creds + Hausing keys in Cloudflare secrets; confirm `POST /token` 200,
      `GET /service-tickets?filter[status]=new` 200, Hausing `GET /v1/buildings` 200.
- [ ] End-to-end: resident files a Sharry ticket with a photo → ingress mirrors to Hausing (photo
      attached) → `processing` in Sharry → haldus resolves → egress pushes the right Estonian
      message + `complete` → resident sees it. Run `verify` (live mode).

---

## Notes
- Both Sharry and Hausing lack webhooks — **polling + claim-first `sharry_ticket_id` dedup are
  load-bearing.** No `updated_at` cursor (the List endpoint has no time filter).
- Pages Functions have **no cron** and **no warm-isolate guarantee** — scheduler is external; the
  access token is cached in **D1**, not memory.
- Ingress is subrequest-heavy → small batch + split from egress to respect Cloudflare + Sharry limits.
- Keep upstream glue in `_sharry.ts` / `_hausing.ts` so it stays unit-testable with mocked `fetch`.
- Never log signed CDN file URLs; `watcherEmail` is optional (never block ingress on email).
