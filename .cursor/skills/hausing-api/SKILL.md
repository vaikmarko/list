---
name: hausing-api
description: Call the Hausing Gateway API (general tickets = fault reports, status, chats, files) from Cloudflare Pages Functions. Use when integrating with Hausing, creating or reading fault reports/tickets, wiring the Sharry -> Hausing relay, or when the user mentions Hausing, veateade, general tickets, or hausing.app.
---

# Hausing Gateway API

Hausing is the property-management system where building faults (veateated) are tracked. A
resident fault report is a **General ticket**. This skill is the agent's working guide for calling
the Hausing external API from this repo's Cloudflare Pages Functions.

Authoritative, full reference: [HAUSING_API.md](../../../docs/integrations/HAUSING_API.md)
(pinned OpenAPI spec: `docs/integrations/hausing-openapi-external-v1.json`). Endpoint cheat-sheet:
[reference.md](reference.md).

## Quick facts

- Base URL: `https://gateway-api.prod.hausing.ee` (override via `env.HAUSING_API_BASE`).
- **Two required headers on every call:**
  - `Authentication: Bearer <JWT>` (note: header is named `Authentication`, not `Authorization`).
  - `X-Hausing-Company: <companyId>` — selects the management company; missing it => 401/403.
- Success responses wrap payload in `{ "data": ... }`. List endpoints are **0-indexed**.
- **No webhooks** and **no idempotency key** exist. Status round-trip = polling; dedup is our job.

## Creating a fault report

```ts
// POST /v1/general-tickets   (or /ai-categorized to let Hausing pick the category)
const res = await fetch(`${base}/v1/general-tickets/ai-categorized`, {
  method: "POST",
  headers: {
    Authentication: `Bearer ${env.HAUSING_API_TOKEN}`,
    "X-Hausing-Company": env.HAUSING_COMPANY_ID,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    title,                 // required
    description,           // resident free text
    watcherEmail,          // resident email -> notifications + chat
    buildingId, roomId,    // from hausing_location_map (tenantId needs both)
    censoredDescription,   // ai-categorized only
  }),
});
// Parse defensively: read text, JSON.parse in try/catch, log raw body.
const ticket = (await res.json())?.data; // { id, number, status }
```

## Reading status (polling)

`GET /v1/general-tickets/{id}` -> `data.status` is one of
`BACKLOG, TO_DO, WAITING, IN_PROGRESS, REVIEW, DONE, NOT_DONE, REJECTED`. Terminal:
`DONE, NOT_DONE, REJECTED` (surface `data.resolution` + `data.endComment` to the resident).

## Rules

- Keep token + company id **server-side only** (Cloudflare secrets / `.dev.vars`). Never in the
  client form.
- Never echo the raw Hausing response body to the client (may carry internal detail). Log it to
  D1 + `console.log` instead, like `functions/api/park.ts`.
- Enforce idempotency with a `client_request_id` UNIQUE in D1 before creating a ticket.
- Until live API keys exist, develop and test against a **mocked `fetch`** (see the
  `cloudflare-integration-proxy` skill and `functions/api/_hausing.test.ts`).
- The auth scheme has a spec inconsistency (`Authentication` bearer vs. a referenced-but-undefined
  `ApiKeyAuth`). Confirm against a live 200 before trusting any assumption.
