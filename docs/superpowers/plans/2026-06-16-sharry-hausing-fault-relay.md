# Sharry -> Hausing Fault Report Relay — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Run the
> `verify` skill before push and the `review` skill after the build is complete.

**Goal:** A resident submits a fault from the Rotermann Sharry app; it creates a Hausing General
ticket; management resolves it in Hausing; the status + resolution return to the resident. Until
Hausing API keys arrive, everything is built and tested against a **mock Hausing** (no live keys).

**Architecture:** Cloudflare Pages Function `functions/api/fault.ts` (mirror of
`functions/api/park.ts`) creates the ticket; `functions/api/hausing-webhook.ts` polls status; D1
tables `fault_reports` + `hausing_location_map` hold mapping/audit. Static resident form under
`teata-veast/`.

**Tech stack:** TypeScript (Cloudflare Pages Functions / Workers runtime), Wrangler, D1 (SQLite).
No framework. **No test runner yet** — add one in Task 0 (see note).

**Spec:** [docs/superpowers/specs/2026-06-16-sharry-hausing-fault-relay-design.md](../specs/2026-06-16-sharry-hausing-fault-relay-design.md)
**API refs:** [docs/integrations/HAUSING_API.md](../../integrations/HAUSING_API.md), [docs/integrations/SHARRY_INTEGRATION.md](../../integrations/SHARRY_INTEGRATION.md)

**Migration required:** YES (`migrations/0002_fault_reports.sql`). Run
`npx wrangler d1 migrations apply list-parking-log --local` then `--remote` after merge.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `package.json` | modify | Add `vitest` + `@cloudflare/vitest-pool-workers` (or `node:test`) + `typecheck`/`test` scripts |
| `tsconfig.json` | create | TS config for Functions (currently none); `@cloudflare/workers-types` |
| `migrations/0002_fault_reports.sql` | create | `fault_reports` + `hausing_location_map` tables + indexes |
| `functions/api/_hausing.ts` | create | Hausing client: `createGeneralTicket`, `getGeneralTicket`, headers/auth, defensive parsing |
| `functions/api/_hausing.test.ts` | create | Unit tests with mocked `fetch` (no live keys) |
| `functions/api/fault.ts` | create | `POST /api/fault` handler (validate, dedup, create ticket, audit) |
| `functions/api/fault/status.ts` | create | `GET /api/fault/status` resident status read |
| `functions/api/hausing-webhook.ts` | create | Poll open tickets, update D1 status/resolution |
| `functions/api/admin/fault-logs.ts` | create | Admin audit view (mirror `admin/logs.ts`) |
| `teata-veast/index.html` | create | Resident fault form (Estonian, mobile) |
| `teata-veast/app.js` | create | Form script (collect Sharry context, mint `client_request_id`, POST) |
| `teata-veast/shared.css` | create or reuse | Reuse `park/shared.css` look |
| `.dev.vars.example` | modify | Add `HAUSING_API_TOKEN`, `HAUSING_COMPANY_ID`, `HAUSING_API_BASE`, `POLL_SECRET` |
| `wrangler.toml` | modify | Add `[vars] HAUSING_API_BASE` (no cron — Pages Functions have none) |
| `.github/workflows/hausing-poll.yml` | create | External scheduler hitting `/api/hausing-webhook` with `POLL_SECRET` |
| `_redirects` | modify | Friendly path for `teata-veast` if needed |
| `park/SETUP.md` sibling | create `teata-veast/SETUP.md` | Setup + Sharry button URL handover note |

---

## Task 0: Toolchain — add type-check + test runner

**Why:** the repo has no `tsconfig.json` and no test runner. KLAARIKS gates (`verify`) assume
both. Add the minimum so we can build/verify without live keys.

- [ ] Add `tsconfig.json` with `"types": ["@cloudflare/workers-types"]`, `strict: true`, module
      `esnext`, target `es2022`.
- [ ] `npm i -D typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers`.
- [ ] Add scripts: `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`.
- [ ] Confirm `npm run typecheck` passes on existing `functions/api/park.ts` (fix types if needed).

## Task 1: D1 migration

- [ ] Create `migrations/0002_fault_reports.sql` with `fault_reports` and `hausing_location_map`
      per spec §3 (all `CREATE TABLE/INDEX IF NOT EXISTS`, UNIQUE on `client_request_id`).
- [ ] Apply locally: `npx wrangler d1 migrations apply list-parking-log --local`.
- [ ] Verify schema: `npx wrangler d1 execute list-parking-log --local --command "PRAGMA table_info(fault_reports)"`.

## Task 2: Hausing client module (`functions/api/_hausing.ts`) — TDD

- [ ] Write `functions/api/_hausing.test.ts` first (mock `fetch`):
      - sends `Authentication: Bearer` + `X-Hausing-Company` headers,
      - posts `GeneralTicketCreateRequest` body,
      - parses `{ data: { id, number, status } }`,
      - handles non-JSON / non-2xx defensively (returns typed error, logs raw),
      - `getGeneralTicket` maps status enum.
- [ ] Implement `_hausing.ts`: `createGeneralTicket(env, payload)`,
      `createAiCategorizedTicket(...)`, `getGeneralTicket(env, id)`. Base URL from
      `env.HAUSING_API_BASE` (default `https://gateway-api.prod.hausing.ee`).
- [ ] `npx vitest run functions/api/_hausing.test.ts` green.

## Task 3: `POST /api/fault` handler

- [ ] Copy structure from `functions/api/park.ts`: `jsonResponse`, `sanitizeContext`,
      `extractUserEmail`, rate-limit helpers (per-IP all events, per-email creates), audit writer.
- [ ] Implement `writeFaultAudit` (INSERT into `fault_reports`) — fail-open via `ctx.waitUntil`.
- [ ] Flow: parse -> rate-limit -> validate (`description` required, caps; `category` optional) ->
      dedup by `client_request_id` (return existing on hit) -> resolve building via
      `hausing_location_map` or `buildingId` override -> call `_hausing` (AI-categorized default) ->
      INSERT mapping -> return `{ ok, ticketNumber, status }`.
- [ ] Concurrency: two simultaneous submits with the same `client_request_id` race the dedup
      SELECT. Rely on the UNIQUE constraint — catch the INSERT unique-violation and return the
      existing row instead of creating a second ticket.
- [ ] Friendly Estonian error messages; never echo upstream body.
- [ ] `onRequest` 405 for non-POST (mirror park.ts).

## Task 4: `GET /api/fault/status`

- [ ] Look up by `client_request_id` (+ `watcher_email` for auth-ish scoping) in D1; return
      cached `hausing_status` + `resolution` mapped to Estonian labels.
- [ ] Do NOT call Hausing synchronously here (status is refreshed by the poller).

## Task 5: Status poller (`functions/api/hausing-webhook.ts`)

- [ ] Select non-terminal `fault_reports`; for each `GET /v1/general-tickets/{id}`; UPDATE
      `hausing_status`/`resolution`/`updated_at`. Make the run idempotent.
- [ ] Guard with `POLL_SECRET` (Bearer) so the endpoint can't be triggered anonymously.
- [ ] **Trigger:** Cloudflare **Pages Functions have no native cron** (Workers-only feature). Do
      NOT add a Cron Trigger to `wrangler.toml`. Instead drive the poll via an external scheduler
      (GitHub Actions cron / cron-job.org) doing `GET /api/hausing-webhook` with the `POLL_SECRET`
      bearer — default for the pilot. (Alternative: a separate Worker with a `scheduled` handler +
      D1 binding; choose only if everything must stay inside Cloudflare.) Runnable via GET in dev.
- [ ] Add `.github/workflows/hausing-poll.yml` (or document the external cron) once the URL is live.

## Task 6: Resident form (`teata-veast/`)

- [ ] `index.html` + `app.js` adapted from `park/`: Estonian copy, category dropdown
      (placeholder until categories endpoint wired), description textarea, optional photo (phase 2).
- [ ] `app.js`: collect Sharry query context, mint `client_request_id` (crypto.randomUUID),
      POST `/api/fault`, render success (ticket number + "Vastu võetud") / error.
- [ ] Reuse `park/shared.css`.

## Task 7: Admin audit + config

- [ ] `functions/api/admin/fault-logs.ts` mirroring `admin/logs.ts` (Bearer `CF_ADMIN_KEY`,
      filters by event/email/since).
- [ ] `.dev.vars.example`: add `HAUSING_API_TOKEN`, `HAUSING_COMPANY_ID`, `POLL_SECRET`.
- [ ] `wrangler.toml`: `[vars] HAUSING_API_BASE`.
- [ ] `teata-veast/SETUP.md`: Cloudflare secrets steps + Sharry button URL handover text.

## Task 8: Verify (no live keys)

- [ ] `npm run typecheck` clean.
- [ ] `npm run test` green (mocked Hausing).
- [ ] `npm run dev` -> `http://localhost:8788/teata-veast/?e=test@example.com` -> submit ->
      confirm D1 row written (mock or real-mocked client) and graceful upstream-down handling.
- [ ] Run the `review` skill (diff mode) on the change set.

## Task 9: Live test (DEFERRED — when API keys arrive)

- [ ] Put `HAUSING_API_TOKEN` + `HAUSING_COMPANY_ID` in Cloudflare secrets (prod + preview).
- [ ] Confirm auth header name + 200 on `GET /v1/buildings`.
- [ ] Seed `hausing_location_map` with real Rotermann building/room ids.
- [ ] End-to-end: submit fault -> verify ticket appears in Hausing -> management resolves ->
      poller updates D1 -> resident status shows "Lahendatud".
- [ ] Run the `verify` skill (full, live mode).

---

## Notes

- Keep `fault.ts` self-contained like `park.ts` (Pages Functions are isolated modules). Shared
  helpers go in `functions/api/_hausing.ts` and a small `functions/api/_shared.ts` if duplication
  with `park.ts` grows — do not over-abstract for two consumers.
- Hausing has **no webhooks** and **no idempotency key** — polling + `client_request_id` dedup are
  load-bearing, not optional.
