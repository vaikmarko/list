# Hausing Gateway API — Reference for the-list-services

Working reference for Hausing's external Gateway API as used by the Sharry -> Hausing
fault-report relay (`functions/api/fault.ts`, `functions/api/hausing-webhook.ts`).

- Authoritative source: <https://doc.hausing.app/api/gateway>
- OpenAPI spec (3.1.0): <https://gateway-api.prod.hausing.ee/api-docs/external-v1>
- Base URL (production): `https://gateway-api.prod.hausing.ee`
- Vendor: Hausing Technologies OÜ — `tech@hausing.ee`
- Postman mirror: <https://documenter.getpostman.com/view/2800273/SW12ywvF>

> A "veateade" (resident fault report) is a **General ticket** in Hausing. This is the
> only resource the relay writes. Maintenance tickets are read-only over this API.

## Authentication

Two headers are required on **every** general-ticket request:

- `Authentication: Bearer <JWT>` — the spec declares an OAuth2 bearer-JWT scheme named
  `Authentication`, sent as a header parameter (not the usual `Authorization` header).
- `X-Hausing-Company: <companyId>` — selects which Hausing company (haldusettevõte) the
  request acts on. Required and easy to forget; a missing/wrong value yields 401/403.

```
Authentication: Bearer eyJhbGciOi...
X-Hausing-Company: 123
Content-Type: application/json
```

Caveats to confirm once API keys arrive (we have no keys yet, so this is from the spec only):

- The spec's global `security` block references an undefined scheme `ApiKeyAuth`, while the
  defined scheme is the `Authentication` bearer above. This is a spec inconsistency — treat
  `Authentication: Bearer <token>` as canonical and verify against a live 200 before trusting it.
- How the JWT is obtained (static long-lived key vs. token exchange / refresh) is **not** in
  the spec. Clarify with Hausing when requesting credentials; store whatever we get as a
  Cloudflare secret (`HAUSING_API_TOKEN`), never in client code.

## Conventions

- All bodies are JSON. Successful responses wrap the payload in `{ "data": ... }`.
- All paged list requests are **0-indexed** (per the spec description).
- Timestamps are ISO 8601 (`createdDate`, `doneDate`, `deadline`).
- Error envelopes:
  - `400` `ValidationErrorResponse` `{ id, message, errors[] }`
  - `404` `PersistenceErrorResponse` `{ id, message, entity, criteria[] }`
  - `401 / 403 / 500` `GenericErrorResponse` `{ id, message }`

## Endpoints used by the relay

### POST /v1/general-tickets — create a fault report (primary write)

Body `GeneralTicketCreateRequest`:

| Field | Type | Notes |
|---|---|---|
| `title` | string | **required** — short summary of the fault |
| `description` | string | free text from the resident |
| `buildingId` | string | Hausing building id (from `GET /v1/buildings`) |
| `roomId` | string | room/apartment id (from `GET /v1/buildings/{buildingId}/rooms`) |
| `tenantId` | string | only usable when `buildingId` **and** `roomId` are set |
| `watcherEmail` | string (email) | resident's email — gets notified / can be a chat participant |
| `categoryId` | int64 | from `GET /v1/general-tickets/categories` |
| `customFields` | object | map of custom-field definition id -> value (see custom-fields endpoints) |
| `contractorId` | string | optional pre-assignment |
| `contractorContactIds` | string[] | optional |

Response: `ResponseGeneralTicketResponse` -> `data: GeneralTicketResponse` (see below). Capture
`data.id` (int64) and `data.number` (human-readable) for our `fault_reports` mapping.

### POST /v1/general-tickets/ai-categorized — create with AI categorization (alternative)

Body `GeneralTicketExtendedCreateRequest` = `GeneralTicketCreateRequest` + `censoredDescription`.
Lets Hausing pick the category automatically. `categoryId` becomes optional. Use this when we
don't want to maintain a category mapping on our side. Categories with
`disableAiCategorization: true` are excluded from auto-categorization.

### GET /v1/general-tickets/{id} — read status (status round-trip source)

Response `GeneralTicketResponse`:

| Field | Type | Notes |
|---|---|---|
| `id` | int64 | |
| `number` | string | human-readable ticket number |
| `status` | enum | `BACKLOG, TO_DO, WAITING, IN_PROGRESS, REVIEW, DONE, NOT_DONE, REJECTED` |
| `title` / `description` | string | |
| `archived` | boolean | |
| `building` / `room` | object | |
| `supervisor` | UserModel | assigned manager |
| `createdDate` / `doneDate` / `deadline` | date-time | ISO 8601 |
| `contractor` | object | |
| `watcherEmail` | string | |
| `tenantId` / `categoryId` / `customFields` | | |
| `resolution` | string | free-text resolution shown to the resident |
| `endComment` | CommentResponse | closing comment |

Terminal statuses for our purposes: `DONE`, `NOT_DONE`, `REJECTED`. Surface `resolution` +
`endComment` to the resident when terminal.

### PATCH /v1/general-tickets/{id} — update status (management action)

Body `GeneralTicketPatchRequest`: `status` (**required**, same enum), `resolution`, `comment`.
Management normally works inside Hausing's own UI; the relay only PATCHes if we add a
management-side action. Not required for the basic resident -> Hausing -> resident flow.

### Resident <-> management communication (chats)

- `POST /v1/general-tickets/{generalTicketId}/chats` — open a chat (`GeneralTicketChatRequest`:
  `senderParticipant`, `receiverParticipant`, each a `TicketChatCreateParticipantModel` keyed by
  `watcherEmail` / `userId` / `crmCompanyId` / `buildingId` / `participantGroupType=MANAGEMENT_USER`).
- `POST /v1/general-tickets/{ticketId}/chats/messages` — post a message
  (`TicketChatRequest`: `participants[]` (first = initiator), `message`, `mentions[]`).
- `GET .../chats` and `GET .../chats/messages` — read the thread.

This is how "info jõuab tagasi inimeseni": the resident (identified by `watcherEmail`) and
management exchange messages on the ticket. We mirror new messages back into the Sharry view.

### Supporting endpoints

- `GET /v1/general-tickets/categories` -> `CategoryResponse[]`. Honor `isVisibleToTenant` —
  only offer tenant-visible categories in the resident form.
- `GET /v1/general-tickets/custom-fields/definitions` (+ `/{definitionId}/options`) — for any
  required custom fields on ticket creation.
- `GET /v1/buildings`, `GET /v1/buildings/{buildingId}/rooms` — resolve building/room ids.
- Tenant satisfaction (feedback loop after resolution):
  `GET /v1/general-tickets/tenant-satisfactions/{id}`,
  `POST /v1/general-tickets/tenant-satisfactions/{id}/submit`
  (`TenantSatisfactionSubmitRequest`: `status` = `ACCEPTED | REJECTED`, `comment`, `answers[]`).

### Attachments (photos of the fault) — three-step upload [IMPLEMENTED]

Implemented in `functions/api/_hausing.ts` (`getFileUploadUrl`, `putFileBytes`,
`linkFileToTicket`, and the `uploadTicketPhoto` convenience wrapper). Called by `fault.ts` after
the ticket is created, best-effort.

1. `GET /v1/files/upload-url` -> `UploadUrlResponse { uploadUrl, fileName }` (pre-signed).
2. `PUT` the raw bytes to `uploadUrl` (no auth header — the URL is already signed; send the
   image `Content-Type`).
3. `POST /v1/files` with `FileCreateRequest`:
   `{ entity: "GENERAL_TICKET", entityId: <ticket id>, fileName, originalFileName,
   visibilities: [ADMIN_MANAGER, MANAGER, TECHNICIAN, ROOM_OWNER, EXTERNAL], creatorContext, creatorName }`.

The exact PUT requirements (method/headers) are not in the spec — confirm against the live API
once keys arrive; the client logs the raw response defensively.

## Notes / gotchas (defensive — confirm against live API)

- **No webhooks.** The external API exposes no webhook/subscription endpoint. The status
  round-trip back to the resident must be **polling**: re-`GET /v1/general-tickets/{id}` (or list
  with an `updatedAfter`-style filter if one exists) on a schedule. Plan for polling first; treat
  any webhook support as a later optimization only if Hausing confirms it out-of-band.
- **No documented idempotency key.** Creating the same ticket twice will create two tickets.
  Enforce dedup on our side (persist `hausing_ticket_id` + a `client_request_id` on the
  `fault_reports` row before/after the call; refuse re-create when set). Same lesson as the
  Merit `sendglbatch` integration in KLAARIKS.
- **`X-Hausing-Company` is mandatory** and not part of the URL — a frequent source of 401/403.
- Paged endpoints are 0-indexed.
- Response schemas are published, but always log the raw upstream body during integration so
  real behavior is captured (the auth scheme inconsistency above means live verification is
  required before we trust any assumption here).
- A pinned copy of the spec used to write this doc lives at
  [docs/integrations/hausing-openapi-external-v1.json](hausing-openapi-external-v1.json).
