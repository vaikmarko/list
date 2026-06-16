# list.ee — The List Services

`list.ee` Cloudflare Pages platvorm: Rotermanni äpi (Sharry) teenuste backend
(külaliste parkimine, veateated) + äri-/esitlusmaterjali host.

Süsteemide kaart ja seosed: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Repo struktuur

```
.
├── index.html, 404.html              # avalik avaleht + veaeleht
├── rotermann-*.html, city-seed-*.html# avalikud esitlused/äriplaanid (LIVE list.ee URL-id)
├── rotermann-infra/                  # infra-esitlus (LIVE)
├── park/                             # Europark külaliste parkimise veebivormid (Sharry WebView)
├── teata-veast/                      # Hausing veateadete veebivorm (Sharry WebView)
├── functions/                        # Cloudflare Pages Functions (API)
│   ├── api/park.ts                   #   Europark parkimine
│   ├── api/fault.ts, fault/status.ts #   Hausing veateated
│   ├── api/_hausing.ts               #   Hausing API klient
│   ├── api/hausing-webhook.ts        #   staatuse poller (väline scheduler)
│   └── api/admin/*                   #   audit-logide vaated
├── migrations/                       # D1 SQLite skeem (parking_events, fault_reports, ...)
├── docs/                             # dokumentatsioon (ei serveerita avalikult — vt _redirects)
│   ├── ARCHITECTURE.md               #   süsteemide kaart
│   ├── integrations/                 #   HAUSING_API.md, SHARRY_INTEGRATION.md (+OpenAPI)
│   └── superpowers/                  #   design-spec + implementation plan
├── .cursor/skills/                   # Cursori agent-skillid (review, verify, hausing-api, ...)
├── wrangler.toml, package.json       # Cloudflare/Wrangler config
│
├── business/                         # LOKAALNE ärimaterjal (gitignore'itud, ei deploy'ta)
│   ├── plans/                        #   äriplaanid (KARMA, WARD, rotermann-ariplaan, talsinki)
│   ├── proposals/                    #   Proposals, Forus pakkumised, Loyal Solutions
│   ├── loyalty/                      #   lojaalsusprogrammi materjal + arhiiv
│   ├── brand/                        #   Rotermanni guidelines, One-Pager pildid
│   └── ward/                         #   Ward pitch (pdf/pptx/html)
└── _archive/                         # LOKAALNE arhiiv (gitignore'itud): vana Django, venv, db.sqlite3
```

## Mis on deploy'tud vs lokaalne

- **Commit'itud = deploy'tud** list.ee-sse (`git ls-files`). Ainult avalikud failid: esitlused,
  `park/`, `teata-veast/`, `functions/`, `migrations/`, config, `docs/` (serveerimine blokeeritud).
- **Lokaalne ainult**: `business/`, `_archive/`, `node_modules/`, `.dev.vars` — gitignore'itud.

## Arendus

```bash
npm run dev        # wrangler pages dev . → http://localhost:8788
npm run typecheck  # TypeScript kontroll
npm test           # functions testid
```

Deploy: push `main` → Cloudflare Pages buildib automaatselt. Setup: [park/SETUP.md](park/SETUP.md),
[teata-veast/SETUP.md](teata-veast/SETUP.md).

## Cursori skillid

Kvaliteedi-/protsessiskillid ja integratsiooni-skillid: [.cursor/skills/](.cursor/skills/)
(vt `README` selles kaustas — kaardistab, millised peegeldavad KLAARIKS-i käske).
