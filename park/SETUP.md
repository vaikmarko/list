# Setup samm-sammult — Marko jaoks

Selles juhendis on **kõik sammud, mida pead ise tegema**, et lahendus läheks live'i. Kood on valmis, vajab ainult Cloudflare seadistust ja DNS-i vahetust.

Eeldatav koguaeg: **~30 minutit** (sh DNS propagatsiooni ootamine).

---

## Samm 1 — Cloudflare account (~3 min)

Kui sul juba on Cloudflare account `list.ee` domeeniga, mine **2. sammu juurde**.

1. Mine [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), tee tasuta account.
2. Vajuta **Add a site**, sisesta `list.ee`, vali **Free** plan.
3. Cloudflare loob nimeserverid (nt `xxx.ns.cloudflare.com`, `yyy.ns.cloudflare.com`).
4. **Mine sinna kuhu praegu list.ee DNS-i haldad** (Zone.ee? domeenitehas.ee?) ja vaheta nimeserverid Cloudflare'i omadeks.
5. Oota 5–15 min kuni Cloudflare näitab "Active" (saadab e-maili).

> **Tähtis:** kui domeen on juba mujal hallatud, saad ka **CNAME**-pohise lähenemise: jätad nimeserverid samaks ja lihtsalt suunad `list.ee` CNAME hiljem Cloudflare Pages URL-ile (samm 6). Aga täielik Cloudflare nimeserveri-haldus on lihtsam ja annab kõik Cloudflare features (analüütika, WAF, jne).

---

## Samm 2 — Loo Cloudflare Pages projekt (~5 min)

1. Cloudflare dashboardis: **Workers & Pages → Create application → Pages → Connect to Git**.
2. Autoriseeri GitHub (esimesel korral).
3. Vali repo: `the-list-services` (või mis iganes name'iga). Vali branch: `main`.
4. **Project name:** `list-ee`
5. **Production branch:** `main`
6. **Build settings:**
   - Framework preset: **None**
   - Build command: *(jäta tühjaks — staatiline sait)*
   - Build output directory: `/` (root)
7. **Save and Deploy**.
8. Esimene deploy kestab ~30 sekundit. Saad URL-i kujul `https://list-ee.pages.dev`.

> Kui deploy ütleb midagi puudvat `wrangler.toml`'is, kontrolli et `pages_build_output_dir = "."` on seal kirjas.

---

## Samm 3 — Lisa secret API võtmed (~3 min)

Cloudflare dashboardis: **Workers & Pages → list-ee → Settings → Environment variables**.

**Production** keskkond, vajuta **Add** → vali **Type: Secret** mõlema jaoks:

| Nimi | Väärtus |
|---|---|
| `EUROPARK_API_KEY_5` | 5. korruse Bearer võti (Merje/Vsevolod e-mail 11.05.2026, "Guest parking (5.korrus) Api Key") |
| `EUROPARK_API_KEY_6` | 6. korruse Bearer võti (sama e-mail, "Guest parking (6.korrus) Api Key") |

> Võtmed asuvad lokaalselt failis `.dev.vars` (gitignored, mitte commit'ida). Kopeeri sealt väärtused dashboardi. **Ära kirjuta neid kuhugi git'i jälgitavasse faili.**

**Preview** keskkond — vajuta `Add` ja kasuta sama 2 võtit (kuni Europark annab eraldi prelive võtmed; siis vaheta need preview's välja).

**Mitte-salajased vars** (PARTNER_ID, PRODUCT_ID jne) on juba `wrangler.toml`'is, neid pole vaja dashboardis seadistada.

**Pärast secret'ide lisamist** vajuta `Deployments → Retry deployment` (et uued vars läheks aktiivseks).

---

## Samm 4 — Testi preview URL-il (~5 min)

1. Ava brauseris: `https://list-ee.pages.dev/park/usre` ja `https://list-ee.pages.dev/park/6korrus`. Pead nägema mobiilivormi.
2. Kontrolli, et **olemasolevad lehed töötavad**:
   - `https://list-ee.pages.dev/` → praegune coming soon
   - `https://list-ee.pages.dev/rotermann-ariplaan-2026.html`
   - `https://list-ee.pages.dev/rotermann-infra/`
   - `https://list-ee.pages.dev/talsinki-prototype.html`
3. **Tee päris parkimistest** (kasuta `TESTAUTO` numbrit):
   - Mobiilivormis sisesta `TESTAUTO`, vajuta "Pargi 3 tundi tasuta"
   - Pead nägema rohelist linnukest ja "Auto on pargitud!"
4. **Kontrolli Europark partner-paneelis**: [https://partner.europark.ee/sessions](https://partner.europark.ee/sessions) — pead nägema äsja loodud sessiooni numbriga TESTAUTO.
5. Kustuta test-sessioon Europark paneelis (või lase aeguda 3h pärast).

Kui mõni samm ei tööta, vaata logisid: **Cloudflare dashboard → list-ee → Functions → Real-time logs** ja proovi uuesti.

---

## Samm 5 — DNS migratsioon (`list.ee` → Cloudflare Pages) (~10 min)

1. Cloudflare dashboardis: **Workers & Pages → list-ee → Custom domains → Set up a custom domain**.
2. Sisesta: `list.ee` (ilma `www.`).
3. Cloudflare ütleb mis DNS-i kirjet vaja lisada. Kui sa **kasutad Cloudflare nimeservereid** (samm 1.4), siis Cloudflare lisab kirje automaatselt. Kui ei, pead `list.ee` CNAME suunama `list-ee.pages.dev` peale.
4. Lisa ka `www.list.ee` → CNAME → `list.ee` (kui tahad et `www` ka töötaks).
5. Oota DNS propagatsiooni (5–30 min). Kontrolli: [https://dnschecker.org/#CNAME/list.ee](https://dnschecker.org/#CNAME/list.ee)

> **Vana GitHub Pages CNAME fail** võib jääda repo'sse — Cloudflare ignoreerib seda. Kui tahad puhast, kustuta `CNAME` fail repost. **Aga ei ole hädavajalik**.

---

## Samm 6 — Lülita GitHub Pages välja (~2 min)

1. GitHub: repo → **Settings → Pages**.
2. **Source: None** (või Branch: None).
3. Salvesta. Nüüd `list.ee` serveerib **ainult** Cloudflare'ist.

---

## Samm 7 — Verifitseeri live'is (~5 min)

1. `https://list.ee/` → coming soon
2. `https://list.ee/park/usre` → 5. korruse vorm
3. `https://list.ee/park/6korrus` → 6. korruse vorm
4. `https://list.ee/rotermann-ariplaan-2026.html` → äriplaan
5. `https://list.ee/rotermann-infra/` → infra esitlus
6. Tee veel üks parkimistest live URL-ilt, kontrolli Europark paneelis.

---

## Samm 8 — Anna äpi devidele üle (~2 min)

Saada Rotermanni äpi arendajatele see kiri (näidis allpool).

### Sharry äpis nuppude seadistamine — audit log'i URL muutujatega

Iga ettevõtte nupule "Guest parking" pane URL'i koos Sharry user-variable'tega.
Süsteem loeb need ja salvestab audit log'i (kelle töötaja registreeris parkimise).

**5. korrus — U.S. Real Estate:**

```
https://list.ee/park/usre-h3k9m2/?u={User ID}&e={User e-mail}&n={User name}&t={Tenant ID}&tn={Tenant name}
```

**6. korrus — U.S. Invest:**

```
https://list.ee/park/us-invest-p7n5q8/?u={User ID}&e={User e-mail}&n={User name}&t={Tenant ID}&tn={Tenant name}
```

> Sharry asendab `{User ID}`, `{User e-mail}` jms tegelike väärtustega kui kasutaja nupule vajutab. Vorm loeb need URL-ist ja saadab serverile, kus need salvestatakse `console.log` JSON-ina (Cloudflare Real-time logs).
> Visible for company: vali õige (USRE või US Invest), mitte "All companies".

---

## Audit logide vaatamine

Iga parkimissündmus (õnnestumine, valideerimisviga, Europark viga) salvestatakse Cloudflare D1 SQLite andmebaasi `list-parking-log` tabelisse `parking_events`. Püsivad **igavesti** (kuni D1 quota — vaikimisi 5 GB Free plan).

Salvestatakse: timestamp, korrus, ettevõte, autonumber, Europark session ID, kasutaja e-mail/nimi/ID Sharry kontekstist, tenant info, IP, riik, User-Agent, raw kontekst JSON, vea kood/sõnum.

### Variant A: brauseri / curl kaudu admin endpoint

`GET https://list.ee/api/admin/logs` — vajab `Authorization: Bearer <CF_ADMIN_KEY>` header'it.

`CF_ADMIN_KEY` on Cloudflare Pages secrets'is (production + preview). Vaata: Dashboard → Workers & Pages → list → Settings → Environment variables → Secret `CF_ADMIN_KEY`.

Filtrid (query params):
- `limit=100` (max 1000), `offset=0`
- `floor=5` või `floor=6`
- `plate=ABC` (osaline match, case-insensitive)
- `email=marko` (osaline match user_email peal)
- `event=park.ok` / `park.upstream_error` / `park.validation_error` / `park.misconfig`
- `since=2026-05-25T00:00:00Z` (ts >= ISO timestamp)

Näide:
```bash
curl -sS "https://list.ee/api/admin/logs?limit=20&floor=5" \
  -H "Authorization: Bearer <CF_ADMIN_KEY>" | jq
```

### Variant B: wrangler d1 execute (lokaalsest terminalist)

Repo juurkaustas:
```bash
# Viimased 20 parkimist
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT ts, floor, plate, user_email, europark_session_id FROM parking_events ORDER BY ts DESC LIMIT 20"

# Konkreetse plate ajalugu
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT * FROM parking_events WHERE plate = 'ABC123' ORDER BY ts DESC"

# Konkreetse kasutaja kõik parkimised
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT ts, plate, company FROM parking_events WHERE user_email = 'marko@usre.ee' ORDER BY ts DESC"

# Päeva statistika ettevõtete kaupa
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT date(ts) AS day, company, COUNT(*) AS n FROM parking_events WHERE event='park.ok' GROUP BY day, company ORDER BY day DESC LIMIT 30"

# Vead viimase 24h jooksul
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT ts, event, error_code, plate, user_email FROM parking_events WHERE event != 'park.ok' AND ts >= datetime('now','-1 day') ORDER BY ts DESC"
```

`--remote` = päringud production D1 andmebaasi peal. Ilma `--remote` läheb lokaalsesse koopiasse (mis on tühi).

Vajab et oleksid Cloudflare'i sisse logitud `wrangler` CLI-ga (`npx wrangler login`) **või** et env vars `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` oleksid seatud.

### Eksport CSV-iks

```bash
npx wrangler d1 execute list-parking-log --remote \
  --command "SELECT * FROM parking_events ORDER BY ts DESC" \
  --json | jq -r '.[0].results | (map(keys) | add | unique) as $cols | $cols, (map([.[ $cols[] ]]) | .[]) | @csv' > parking-events.csv
```

### D1 database info

- **Database ID:** `bbc15fcd-6478-45b1-8322-f5df25be12d6`
- **Region:** EEUR (East Europe — madal latency Tallinnale)
- **Binding name Function'is:** `DB` (kasuta `env.DB.prepare(...)`)
- **Schema (parking_events tabel):** `id, ts, event, floor, company, plate, europark_session_id, europark_status, start_time, end_time, user_email, user_name, user_id, tenant_id, tenant_name, ip, country, user_agent, referer, raw_context, error_code, error_message, duration_ms`
- **Indexed columns:** ts (DESC), plate, user_email, floor

## Edaspidi: muudatuste tegemine

1. Muuda kood lokaalselt.
2. Test: `npm run dev` → `http://localhost:8788`
3. `git add -A && git commit -m "muudatus" && git push origin main`
4. Cloudflare deploy'b automaatselt ~30 sekundi jooksul.
5. Iga muu branch saab automaatselt preview URL-i kujul `https://<commit-hash>.list-ee.pages.dev` — saad testida enne main'i merge'imist.

---

## E-mail Rotermanni äpi devidele (kopeeri-kleebi)

```
Tere!

Rotermanni äpis 5. ja 6. korruse rentnike vaadetesse palun lisada nupp "Külaline parkima",
mis avab WebView'is selle URL-i:

  5. korrus (U.S. Real Estate):   https://list.ee/park/usre
  6. korrus (Forus & US Invest):  https://list.ee/park/6korrus

WebView seaded:
  - Header User-Agent võib olla tavaline
  - JavaScript: enabled (vajalik)
  - Cookies: ei vaja
  - Viewport: width=device-width (vormid on mobile-only responsive)
  - Sulgemise nupp äpi natiivelemendina, kuna vorm ise on puhas WebView

Vormi käitumine:
  - Külaline sisestab autonumbri
  - Vajutab "Pargi 3 tundi tasuta"
  - Näeb kinnitusekraani, kuhu jääb "Pargi veel auto" nupp (ei sulge ise)

Lehe enda peal pole midagi tundlikku — turvalisus käib backendi pool
(Cloudflare Pages Function + secret API key). Saate panna äpis kasvõi
public WebView'sse.

Probleemid/küsimused → hello@list.ee

Marko
```
