# Rotermanni külaliste parkimine

Lihtsad WebView-vormid Rotermanni äpis, mille kaudu rentnikud panevad oma külalised 3 tunniks tasuta parkima Europark API kaudu.

- **5. korrus** (U.S. Real Estate): `https://list.ee/park/usre`
- **6. korrus** (Forus & US Invest jagatud): `https://list.ee/park/6korrus`

## Arhitektuur

```
Rotermann äpp (WebView)
    │
    ├── GET  https://list.ee/park/usre/      → staatiline HTML vorm
    ├── GET  https://list.ee/park/6korrus/   → staatiline HTML vorm
    │
    └── POST https://list.ee/api/park        → Cloudflare Pages Function
                                                  ├── valideerib autonumbri
                                                  ├── valib õige API key + product ID
                                                  └── POST → partner.europark.ee
```

API võtmed elavad Cloudflare keskkonnamuutujates (secrets) — **mitte kunagi browseris**.

## Failid

| Fail | Kirjeldus |
|---|---|
| [shared.css](shared.css) | Mobile-first stiilid, Rotermanni punane (`#c0392b`), Inter font |
| [app.js](app.js) | Klient-skript, numbri valideerimine, vormi POST, tulemuse ekraan |
| [usre/index.html](usre/index.html) | 5. korruse vorm (`data-floor="5"`) |
| [6korrus/index.html](6korrus/index.html) | 6. korruse vorm (`data-floor="6"`) |
| [../functions/api/park.ts](../functions/api/park.ts) | Backend proxy → Europark API |
| [../wrangler.toml](../wrangler.toml) | Cloudflare Pages konfiguratsioon |
| [../.dev.vars.example](../.dev.vars.example) | Lokaalsete secret'ide template |

## Konfiguratsioon

### Production secrets (Cloudflare dashboard)

`Workers & Pages → list-ee → Settings → Environment variables → Production → Add`, type **Secret**:

| Nimi | Väärtus |
|---|---|
| `EUROPARK_API_KEY_5` | 5. korruse Bearer võti (vt e-mail) |
| `EUROPARK_API_KEY_6` | 6. korruse Bearer võti (vt e-mail) |

### Mitte-salajased vars (juba `wrangler.toml`'is)

| Nimi | Production | Preview |
|---|---|---|
| `EUROPARK_PARTNER_ID` | `4994` | `4994` |
| `EUROPARK_PRODUCT_ID_5` | `3324` | `3324` |
| `EUROPARK_PRODUCT_ID_6` | `3325` | `3325` |
| `EUROPARK_API_BASE` | `https://partner.europark.ee/admin/api/v2/public` | `https://partner-prelive.europark.ee/admin/api/v2/public` |
| `PARKING_HOURS` | `3` | `3` |

## Lokaalne arendus

```bash
# 1) Esmakordne setup
npm install

# 2) Kopeeri secret-template ja täida API võtmed
cp .dev.vars.example .dev.vars
# (.dev.vars on gitignored)

# 3) Käivita
npm run dev
# Avab http://localhost:8788
```

Test käsitsi:
```bash
curl -X POST http://localhost:8788/api/park \
  -H "Content-Type: application/json" \
  -d '{"floor":"5","plate":"123ABC"}'
```

## Deploy

Automaatselt iga `git push` peale (kui Cloudflare Pages on GitHub repoga ühendatud). Käsitsi:

```bash
npm run deploy
```

## API spetsifikatsioon

**POST `/api/park`**

Request body:
```json
{
  "floor": "5",        // "5" või "6"
  "plate": "123ABC"    // 2-10 A-Z/0-9, ilma tühikuteta
}
```

Edukas vastus (200):
```json
{
  "ok": true,
  "session_id": "...",
  "plate": "123ABC",
  "start_time": "2026-05-25T08:00:00Z",
  "end_time": "2026-05-25T11:00:00Z",
  "status": "active"
}
```

Vea vastus (400/502):
```json
{
  "ok": false,
  "error": "invalid_plate",
  "message": "Selgitus eesti keeles, mida UI näitab"
}
```

Veakoodid:
| `error` | HTTP | Tähendus |
|---|---|---|
| `invalid_json` | 400 | Body ei ole valiidne JSON |
| `invalid_floor` | 400 | `floor` puudu või vale |
| `invalid_plate` | 400 | Autonumber ei vasta formaadile |
| `server_misconfigured` | 500 | Mõni env-muutuja puudu (vt Cloudflare dashboard) |
| `upstream_unreachable` | 502 | Europark API ei vasta (võrk) |
| `upstream_401` / `_403` | 400 | API võti vale või kehtetu |
| `upstream_422` | 400 | Europark keeldus (nt vale autonumbri formaat) |
| `upstream_500+` | 502 | Europark API viga |
