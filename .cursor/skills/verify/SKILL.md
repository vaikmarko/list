---
name: verify
description: End-to-end verification gate for a change before push - static gates (typecheck, tests, lint) first, then live verification matched to the change (curl + D1 for API, real browser for UI). Use after implementing a feature or fix, or before pushing/deploying in the-list-services.
disable-model-invocation: true
---

# End-to-End Verification

Verify that a change actually works. Static gates first, then live verification matched to the
shape of the change. Do not test endpoints the UI doesn't call. Adapted for Cloudflare Pages
Functions + D1 + wrangler. (Mirrors KLAARIKS `/verify`.)

## Mode decision (FIRST)

State the mode in the first line of output:

- **API mode** — a Function's behavior changed (`functions/api/*.ts`). Live check = curl + D1
  before/after (Part B).
- **UI mode** — a static form/page changed (`*/index.html`, `*/app.js`). Live check = drive the
  real browser (Part C). Curling the API is NOT verification of a UI change.
- **Both** — full-stack change -> Part B then Part C.
- **None** — pure docs/config/types. Static gates (Part A) are the whole verification; say so.

## Part A: Static gates (always)

### A1. Type-check
```bash
npm run typecheck   # tsc --noEmit
```
If `tsconfig.json` / the `typecheck` script does not exist yet, add them (`@cloudflare/workers-types`,
`strict: true`) and note that this gate was newly introduced. A type error is a stop.

### A2. Tests
```bash
npm run test        # vitest run
```
If no test runner exists yet, add `vitest` + `@cloudflare/vitest-pool-workers` (or `node:test`) and
note the gap. External-API client modules (`functions/api/_<vendor>.ts`) must have unit tests with
a mocked `fetch`. A new failure is a stop; document any pre-existing failure separately.

### A3. Lint (when configured)
No ESLint config ships yet. If one is added, run it and treat errors (not warnings) as blocking.
Until then, type-check is the mechanical gate.

## Part B: API mode — curl + D1 before/after

### B1. Run the dev server
```bash
npm run dev         # wrangler pages dev . -> http://localhost:8788
```

### B2. Identify the exact endpoint the form calls
Read the relevant `*/app.js` for the `fetch('/api/...')` URL + method + body shape. Test only that.

### B3. State BEFORE
```bash
npx wrangler d1 execute list-parking-log --local \
  --command "SELECT * FROM <table> ORDER BY ts DESC LIMIT 5"
```

### B4. Execute
Call the endpoint with the exact payload the frontend sends. Check the response for errors.

### B5. State AFTER
Re-query D1. Confirm the expected row(s) changed and nothing unexpected did. For integrations,
confirm: success path writes the mapping row; validation rejects bad input; duplicate
`client_request_id` returns the existing record; upstream-down returns a friendly retryable error
and logs `*.upstream_error` (not a false success).

### B6. Reverse/idempotency
If the action is repeatable, repeat it and confirm dedup/rate-limit behaves as designed.

## Part C: UI mode — drive the real browser

Use the cursor-ide-browser MCP (navigate, snapshot, click, fill, screenshot).

1. `npm run dev`, open `http://localhost:8788/<form-path>/?e=test@example.com&n=Test`.
2. Reproduce the user flow: fill, submit, observe the success/error screen.
3. Verify Estonian copy is correct (an English leak in resident UI is a finding).
4. `take_screenshot` of the end state as evidence.
5. Check console + network: no errors, no failed/4xx/5xx requests from the flow.
6. If the change claims persistence, reload and confirm the state survived (or re-check D1).

## Report

Open with the banner line:

```
<emoji> verify — <verdict>
```

- `✅ verify — all checks pass (<mode>)`
- `⚠️ verify — passing, but <concern>`
- `🚨 verify — failed at <step> — <one-sentence cause>`

State the mode run and why. Include the screenshot reference for UI mode. If anything failed,
identify the root cause before reporting. List pre-existing failures separately — never omit them
silently.

For external-API integrations, use the [integration-verify](../integration-verify/SKILL.md)
specialization (adds no-live-keys mock mode).
