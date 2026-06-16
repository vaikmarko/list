---
name: integration-review
description: Specialization of the review skill for external-API integrations on Cloudflare Pages Functions + D1 (Hausing/Sharry fault relay, Europark, etc.). Use when reviewing a plan or diff that adds or changes a functions/api/*.ts proxy, an external API client, or a D1 migration for integration data.
disable-model-invocation: true
---

# Integration Review

Run the general [review](../review/SKILL.md) skill first (plan or diff mode), then apply these
integration-specific checks on top. Do not duplicate the general checklist here.

## Extra checks for API-proxy integrations

### Secrets and data exposure
- Upstream API key / token read only from `env`, never hardcoded, never sent to the client.
- No raw upstream response body returned to the client on error (only a friendly mapped message).
- D1 / logs do not store more PII than needed; Sharry `context` is sanitized (capped keys/values).

### Resilience
- Upstream `fetch` wrapped in `try/catch`; non-JSON and non-2xx responses parsed defensively.
- Audit writes go through `ctx.waitUntil` and are **fail-open** (never block the user response).
- Rate-limit D1 queries are fail-open on error.
- Critical-path writes (e.g. creating a Hausing ticket) return a **retryable** error on upstream
  failure and are NOT reported to the user as success.

### Correctness for this domain
- Idempotency: a `client_request_id` (or equivalent) is UNIQUE in D1 and checked before the
  upstream create — the upstream has no native dedup.
- Status round-trip uses **polling** (Hausing has no webhooks); terminal statuses stop polling.
- Required upstream headers present (Hausing: `Authentication` bearer + `X-Hausing-Company`).
- Building/room/identity mapping (Sharry ids -> Hausing ids) is resolved, not assumed.

### Migration safety
- New migration is append-only, `IF NOT EXISTS`, with the right indexes (dedup key UNIQUE).
- Applied locally (`--local`) before any `--remote`.

## Verdict
Use the review skill's verdict format, prefixed `integration-review`.
