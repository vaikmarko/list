# Sharry Integration — Reference for the-list-services

How the Rotermann app (a white-label **Sharry** deployment) feeds the-list-services
Cloudflare Pages Functions. Sharry is an external system; we never call it back over an API.
Integration is one-directional ingress: Sharry opens a WebView at one of our URLs.

The existing guest-parking flow (`functions/api/park.ts` + `park/app.js`) is the canonical
pattern; the Sharry -> Hausing fault relay reuses it 1:1.

## How Sharry passes context

In Sharry, a tenant-facing button is configured with a URL containing Sharry variable
placeholders. When the user taps it, Sharry substitutes real values and opens a WebView:

```
https://list.ee/teata-veast/rotermann/?u={User ID}&e={User e-mail}&n={User name}&t={Tenant ID}&tn={Tenant name}&b={Base location ID}&s={Site ID}
```

Known Sharry variables (per the parking setup): `User e-mail`, `User name`, `User ID`,
`Tenant name`, `Tenant ID`, `Primary site`, `Base location ID`, `Site ID`. We map them to short
query keys (`u`, `e`, `n`, `t`, `tn`, ...) to keep URLs compact.

The page is a static HTML form + small script. The script collects **all** query params into a
`context` object (capped per key length) and POSTs them with the user's input:

```16:40:park/app.js
  var floor = form.getAttribute('data-floor');

  // Sharry äpp suunab URL-i kaudu kasutaja andmed query parameetritena.
  // Kogume kõik saadud query paramid ja saadame Function'ile audit log'iks.
  function collectContext() {
    var ctx = {};
    try {
      var params = new URLSearchParams(window.location.search);
      params.forEach(function (value, key) {
        if (value && value !== 'undefined' && value !== 'null') {
          ctx[key] = String(value).slice(0, 200);
        }
      });
    } catch (e) {}
    return ctx;
  }
```

The Function then sanitizes `context` server-side (see `sanitizeContext` and `extractUserEmail`
in `functions/api/park.ts`) — never trust client values for length, type, or key count.

## WebView requirements (tell the Sharry/app devs)

- JavaScript enabled (required); cookies not needed.
- `viewport width=device-width` — forms are mobile-only responsive.
- Native close button in the app shell; the page itself does not self-close.
- No secrets on the page — all upstream auth happens server-side with Cloudflare secrets.
- "Visible for company" must target the correct Sharry company, not "All companies".

## Applying the pattern to fault reports

The fault-report form is the same shape as the parking form:

- URL: `https://list.ee/teata-veast/rotermann/?e={User e-mail}&n={User name}&t={Tenant ID}&tn={Tenant name}&b={Base location ID}`
- Form fields (resident input): category (from Hausing tenant-visible categories), free-text
  description, optional photo.
- POST `/api/fault` with `{ category, description, context }`.
- Identity: the Sharry `User e-mail` becomes Hausing's `watcherEmail` so notifications and the
  ticket chat reach the right resident. `Base location ID` / `Site ID` are what we map to a
  Hausing `buildingId` / `roomId` (mapping table TBD once we have real building ids).

### Identity / building mapping (open until live)

Sharry context carries Sharry's own ids (Site ID, Base location ID, Tenant ID) — **not** Hausing
building/room ids. We need a mapping from Sharry location -> Hausing `buildingId`/`roomId`. Options:

1. Static mapping in config/D1 (simplest; small fixed building set like Rotermann).
2. Resolve at runtime from `GET /v1/buildings` + rooms by matching name/address.

Decide during the build phase; (1) is the default for the Rotermann pilot. The resident's
`watcherEmail` is the reliable cross-system key for the communication loop.

## Status round-trip back to the resident

Hausing exposes **no webhooks** (see [HAUSING_API.md](HAUSING_API.md)), so the resident-facing
status is delivered by:

1. A scheduled poll (`functions/api/hausing-webhook.ts` / cron) reads ticket status + new chat
   messages and updates the `fault_reports` D1 row.
2. The resident sees status either by reopening the same WebView (which fetches current status
   for their `watcherEmail`/ticket) or via a push the app triggers. Sharry push is out of our
   control; the WebView status view is the baseline.

## Audit + privacy

Every event is logged to D1 with the Sharry context (like `parking_events`) so we can answer
"who reported what, when, and what happened". Keep the same hygiene as parking: cap sizes,
store only what's needed, and never echo upstream error bodies to the client.
