# Teata veast — setup & Sharry handover

Resident fault-report form (Rotermann / Sharry WebView) that relays to Hausing, **including an
optional photo**. Mirrors the `park/` setup. Code: `functions/api/fault.ts`, `_hausing.ts`,
`fault/status.ts`, `hausing-webhook.ts`, `admin/fault-logs.ts`. Data:
`migrations/0002_fault_reports.sql`, `migrations/0003_fault_attachment.sql`.

The photo flow: the client downscales the image (max 1600px, JPEG q0.8 — also strips EXIF/GPS) and
sends base64; `fault.ts` creates the ticket, then uploads the photo to Hausing (3 steps:
`GET /v1/files/upload-url` -> `PUT` bytes -> `POST /v1/files` linking it to the ticket as a
`GENERAL_TICKET` attachment). Photo upload is **best-effort**: if it fails the report still lands
and the client is told the photo could not be attached.

## 1. Apply the migration

```bash
# local
npx wrangler d1 migrations apply list-parking-log --local
# production (after deploy lands)
npx wrangler d1 migrations apply list-parking-log --remote
```

## 2. Cloudflare secrets (Pages project)

Set these as **encrypted secrets** (Pages → Settings → Environment variables), for both Production
and Preview. Never commit them.

| Name | What |
|---|---|
| `HAUSING_API_TOKEN` | Hausing JWT/API token (sent as `Authentication: Bearer <token>`) |
| `HAUSING_COMPANY_ID` | Hausing company id (sent as `X-Hausing-Company`) |
| `POLL_SECRET` | Random string guarding `GET /api/hausing-webhook` |
| `CF_ADMIN_KEY` | Already used by `/api/admin/*`; also gates `/api/admin/fault-logs` |

`HAUSING_API_BASE` is non-secret and lives in `wrangler.toml` `[vars]`.

Local dev: copy `.dev.vars.example` → `.dev.vars` and fill the values.

## 3. Seed building/room mapping (once real Hausing ids are known)

```bash
npx wrangler d1 execute list-parking-log --remote --command \
 "INSERT INTO hausing_location_map (sharry_site_id, hausing_building_id, hausing_room_id, label)
  VALUES ('<sharry-site-id>', '<hausing-building-id>', NULL, 'Rotermann ...')"
```

Until seeded, `/api/fault` accepts a `buildingId` override in the request body for testing.

## 4. Sharry button URL (handover to the app vendor)

Sharry opens the form in a WebView and appends the resident context as query parameters (same
mechanism as parking — see `docs/integrations/SHARRY_INTEGRATION.md`). Point the Sharry "Teata
veast" button at:

```
https://<your-domain>/teata-veast/?e={{user.email}}&n={{user.name}}&t={{tenant.id}}&s={{site.id}}
```

The form forwards every query param as sanitized `context`; the Function uses `e` (email) for
Hausing `watcherEmail` and `s` (site id) to resolve the building via `hausing_location_map`.

## 5. Status round-trip (polling — Pages has no cron)

Cloudflare **Pages Functions cannot run cron**. Drive the poller from an external scheduler hitting
the endpoint every ~20 min with the `POLL_SECRET`:

```bash
curl -s https://<your-domain>/api/hausing-webhook \
  -H "Authorization: Bearer $POLL_SECRET"
```

Use GitHub Actions cron, cron-job.org, or a separate Cloudflare Worker with a `scheduled` handler.
The resident reads the latest cached status via the form's "Kontrolli staatust" button
(`GET /api/fault/status?id=<client_request_id>&email=<email>`).

## 6. Admin / audit

```bash
# via endpoint
curl -s "https://<your-domain>/api/admin/fault-logs?event=fault.upstream_error" \
  -H "Authorization: Bearer $CF_ADMIN_KEY"
# or directly
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT ts, event, hausing_ticket_number, hausing_status, error_code FROM fault_reports ORDER BY ts DESC LIMIT 50"
```

## 7. Verify before ship

`npm run typecheck` · `npm run test` · local smoke via `npm run dev` →
`http://localhost:8788/teata-veast/?e=test@example.com`. See the `integration-verify` skill
(mock mode until live keys arrive).
