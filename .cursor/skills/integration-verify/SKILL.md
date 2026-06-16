---
name: integration-verify
description: Specialization of the verify skill for external-API integrations on Cloudflare Pages Functions + D1, including a no-live-keys mock mode. Use when verifying a functions/api/*.ts proxy (Hausing/Sharry fault relay, Europark) before push, with or without live API credentials.
disable-model-invocation: true
---

# Integration Verify

Run the general [verify](../verify/SKILL.md) skill, then apply these integration specifics. The key
addition is a **mock mode** for when live API keys are not yet available.

## Mode decision (FIRST)

- **Mock mode** — no live upstream credentials. Verify with unit tests against a mocked `fetch`
  plus a local `wrangler pages dev` smoke test that hits the D1 path. State that live upstream was
  NOT exercised.
- **Live mode** — credentials present. Do mock mode AND a real end-to-end call.

## Static gates (always)

- `npm run typecheck` (add `tsconfig.json` + `tsc` if missing — note the gap).
- `npm run test` (add vitest if missing — note the gap). Unit tests for the `_<vendor>.ts` client
  must mock `fetch` and cover: correct headers/body, `{ data }` parsing, non-JSON/non-2xx handling.

## Mock-mode live check

```bash
npm run dev   # wrangler pages dev . -> http://localhost:8788
# Submit through the form or curl the endpoint with a test payload:
curl -s localhost:8788/api/fault -X POST -H 'Content-Type: application/json' \
  -d '{"description":"test","client_request_id":"00000000-0000-0000-0000-000000000000","context":{"e":"test@example.com"}}'
# Confirm the D1 row was written:
npx wrangler d1 execute list-parking-log --local \
  --command "SELECT event, hausing_ticket_id, error_code FROM fault_reports ORDER BY ts DESC LIMIT 3"
```

Verify: validation rejects bad input; duplicate `client_request_id` returns the existing record;
upstream-down path returns a friendly retryable error (not a false success) and logs `*.upstream_error`.

## Live-mode check (when keys arrive)

- Confirm auth header name + a 200 on `GET /v1/buildings`.
- Create a real fault -> verify the ticket appears in Hausing -> resolve it in Hausing -> poller
  updates D1 -> resident status shows the terminal state.

## UI check

For the resident form, drive the real browser (cursor-ide-browser MCP): submit, confirm Estonian
copy, success/error states, and no console/network errors.

## Verdict
Use the verify skill's verdict format, prefixed `integration-verify`, and state the mode
(mock / live) and whether live upstream was exercised.
