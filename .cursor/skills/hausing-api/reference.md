# Hausing API endpoint cheat-sheet

Full reference + caveats: `docs/integrations/HAUSING_API.md`. This file is the quick lookup the
agent reads while wiring code.

Base URL: `https://gateway-api.prod.hausing.ee`. Headers on every call:
`Authentication: Bearer <JWT>`, `X-Hausing-Company: <companyId>`. Envelope: `{ data: ... }`.

## General tickets (= fault reports)

| Method | Path | Body / notes |
|---|---|---|
| POST | `/v1/general-tickets` | `GeneralTicketCreateRequest` — `title*`, `description`, `buildingId`, `roomId`, `tenantId`, `watcherEmail`, `categoryId`, `customFields`, `contractorId`, `contractorContactIds[]` |
| POST | `/v1/general-tickets/ai-categorized` | above + `censoredDescription`; `categoryId` optional (AI picks) |
| GET | `/v1/general-tickets/{id}` | -> `GeneralTicketResponse` |
| PATCH | `/v1/general-tickets/{id}` | `status*`, `resolution`, `comment` |
| GET | `/v1/general-tickets` | list (0-indexed paging) |

`GeneralTicketResponse`: `id` (int64), `number` (string), `status` (enum below), `title`,
`description`, `archived`, `building`, `room`, `supervisor`, `createdDate`, `doneDate`,
`deadline`, `contractor`, `watcherEmail`, `tenantId`, `categoryId`, `customFields`, `resolution`,
`endComment`.

Status enum: `BACKLOG, TO_DO, WAITING, IN_PROGRESS, REVIEW, DONE, NOT_DONE, REJECTED`.

## Resident <-> management chat

| Method | Path | Body |
|---|---|---|
| POST | `/v1/general-tickets/{id}/chats` | `senderParticipant*`, `receiverParticipant*` (`TicketChatCreateParticipantModel`) |
| POST | `/v1/general-tickets/{ticketId}/chats/messages` | `participants[]*` (first = initiator), `message`, `mentions[]` |
| GET | `/v1/general-tickets/{ticketId}/chats` / `.../chats/messages` | read thread |

Participant keys: `watcherEmail`, `userId`, `crmCompanyId`, `crmCompanyContactId`, `buildingId`,
`hausingCompanyId`, `participantGroupType=MANAGEMENT_USER`.

## Supporting

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/general-tickets/categories` | honor `isVisibleToTenant` for the resident form |
| GET | `/v1/general-tickets/custom-fields/definitions` (+ `/{id}/options`) | required custom fields |
| GET | `/v1/buildings`, `/v1/buildings/{buildingId}/rooms` | resolve building/room ids |
| GET | `/v1/general-tickets/tenant-satisfactions/{id}` ; POST `.../submit` | feedback (`ACCEPTED|REJECTED`, comment, answers) |

## Attachments (three-step) — IMPLEMENTED in `_hausing.ts`

Use `uploadTicketPhoto(env, {...})` (wraps the three steps). `fault.ts` calls it best-effort after
the ticket is created.

1. `GET /v1/files/upload-url` -> `{ uploadUrl, fileName }`.
2. `PUT` raw bytes to `uploadUrl` (no auth header — pre-signed; send the image `Content-Type`).
3. `POST /v1/files` `FileCreateRequest`: `entity: "GENERAL_TICKET"`, `entityId`, `fileName`,
   `originalFileName`, `visibilities: [ADMIN_MANAGER, MANAGER, TECHNICIAN, ROOM_OWNER, EXTERNAL]`,
   `creatorContext`, `creatorName`.

## Errors

`400 ValidationErrorResponse {id,message,errors[]}` · `404 PersistenceErrorResponse
{id,message,entity,criteria[]}` · `401/403/500 GenericErrorResponse {id,message}`.
