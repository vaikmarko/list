---
name: cloudflare-integration-proxy
description: Build a secure Cloudflare Pages Function that proxies an external API with D1 audit logging, rate limiting, input sanitization, and fail-open patterns. Use when adding a new functions/api/*.ts endpoint in the-list-services, proxying a third-party API (Hausing, Europark, etc.), or handling secrets/keys server-side for a static Sharry/WebView form.
---

# Cloudflare Integration Proxy

Codifies the proven pattern in `functions/api/park.ts`: a Pages Function holds the secret API key,
validates and sanitizes client input, calls an upstream API server-side, writes a persistent audit
log to D1, and never leaks upstream internals to the client. Reuse it for every new integration.

## Stack

- Cloudflare Pages Functions (`functions/api/<name>.ts`), Workers runtime, TypeScript.
- D1 SQLite (binding `DB`), migrations in `migrations/` (see `migrations/README.md`).
- Dev: `npm run dev` -> `http://localhost:8788`. Deploy: `git push` (auto) or `npm run deploy`.
- Secrets: Cloudflare dashboard (production + preview) + `.dev.vars` locally (gitignored).
- No test runner / tsconfig yet — add `tsconfig.json` + vitest (`@cloudflare/vitest-pool-workers`)
  when a function needs unit tests. Note this gap when verifying.

## Required structure (mirror park.ts)

1. **`interface Env`** — typed bindings: upstream secrets, non-secret vars, `DB: D1Database`.
2. **`onRequestPost`** handler + **`onRequest`** returning 405 for other methods.
3. **Input parse + validate** — `try/catch` on `request.json()`; validate every field, cap lengths,
   reject with `jsonResponse(400, ...)`.
4. **`sanitizeContext(input)`** — keep only string values, cap key count + value length, drop
   `undefined`/`null`. Never trust client `context`.
5. **Rate limit** via D1 counts — per-IP (all events) and per-user-email (successful actions),
   **fail-open** if the D1 query errors (`return { allowed: true }`).
6. **Audit log to D1** through `ctx.waitUntil(...)` — must NEVER block or fail the user response.
7. **Upstream call** with the secret from `env`; read body defensively (json vs text in try/catch).
8. **Error handling** — on non-2xx, log full detail to D1 + `console.log`, return a friendly
   (Estonian) message to the client; **never** echo the raw upstream body.

## Non-negotiable rules

- Secrets only in `env` (Cloudflare secrets / `.dev.vars`). Never in client HTML/JS, never in git.
- `jsonResponse` sets `Cache-Control: no-store`.
- Capture CF network audit from headers: `CF-Connecting-IP`, `CF-IPCountry`, `User-Agent`, `Referer`.
- Sharry passes user context as URL query params; the static form forwards them as `context` (see
  the `hausing-api` skill and `docs/integrations/SHARRY_INTEGRATION.md`).
- Idempotency: if the upstream has no dedup, persist a `client_request_id` UNIQUE in D1 and refuse
  duplicates before calling upstream.
- Schema changes go through `migrations/` (append-only, `IF NOT EXISTS`); never edit applied files.

## Snippets to copy

`jsonResponse`, `sanitizeContext`, `extractUserEmail`, `writeAuditLog`, `checkIpRateLimit`,
`checkEmailRateLimit` all exist verbatim in `functions/api/park.ts` — copy and rename per
integration rather than re-deriving. Keep upstream-specific glue (auth headers, payload mapping,
response parsing) in a small `functions/api/_<vendor>.ts` module so it can be unit-tested with a
mocked `fetch`.

## Admin visibility

Mirror `functions/api/admin/logs.ts` for a read-only audit endpoint guarded by
`Authorization: Bearer <CF_ADMIN_KEY>`, with filters (event, email, since). Also queryable via
`npx wrangler d1 execute <db> --remote --command "..."`.
