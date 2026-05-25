# D1 schema migrations

Cloudflare D1 (`list-parking-log`) andmebaasi skeemi muudatused on hallatavad
[`wrangler d1 migrations`](https://developers.cloudflare.com/d1/reference/migrations/)
käskudega. Iga fail siin kataloogis on **append-only** — kord deploy'tud
migration'i ei muudeta tagasiulatuvalt.

## Failistruktuur

```
migrations/
  0001_initial.sql       # parking_events tabel + indexid
  0002_<lyhike_kirjeldus>.sql   # tulevikus...
  README.md              # see fail
```

Failinime convention: `<4-kohaline-jrk>_<lyhike_snake_case_nimi>.sql`. Wrangler
loeb need järjekorras ja rakendab puuduvad.

## Kuidas muudatust teha

### 1. Loo uus migration fail

```bash
npx wrangler d1 migrations create list-parking-log lisa_mobile_veerg
```

Loob faili `migrations/0002_lisa_mobile_veerg.sql`. Kirjuta sinna SQL:

```sql
ALTER TABLE parking_events ADD COLUMN mobile TEXT;
CREATE INDEX IF NOT EXISTS idx_parking_events_mobile ON parking_events(mobile);
```

### 2. Lokaalne test (valikuline)

```bash
npx wrangler d1 migrations apply list-parking-log --local
```

Rakendab lokaalsesse SQLite koopiasse (`.wrangler/state/v3/d1/...`).

### 3. Live applikatsioon

```bash
npx wrangler d1 migrations apply list-parking-log --remote
```

Wrangler võrdleb juba rakendatud migration'eid (`d1_migrations` tabelis) failidega
ja jooksutab puuduvad järjest.

### 4. Vaata applied migration'eid

```bash
npx wrangler d1 migrations list list-parking-log --remote
```

## Esmane bootstrap (üks kord)

Algne schema (`0001_initial.sql`) loodi **enne** wrangler migrations setup'i
otse REST API CREATE TABLE-iga. Kõik klauslid kasutavad `IF NOT EXISTS`, nii et
esimene `wrangler d1 migrations apply --remote` käivitamine on safe no-op
olemasolevatel tabelitel ja lihtsalt registreerib 0001 `d1_migrations` tabelis.

```bash
# Esimene kord:
npx wrangler d1 migrations apply list-parking-log --remote
# Output: "Migration 0001_initial.sql applied" (safely no-op olemasolevatele tabelitele)
```

## Tähtsad reeglid

1. **Mitte muuta vanu migration'eid** — kord rakendatud failid on kanoonilised.
   Vea parandus → uus migration nt `0002_fix_typo.sql`.
2. **Idempotentne, kui võimalik** — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX
   IF NOT EXISTS`, `ALTER TABLE ADD COLUMN` (SQLite ei toeta `IF NOT EXISTS`-i
   ALTER TABLE peal, aga kahekordne ALTER annab vea, mis on OK kuna migration
   ei käivitu uuesti).
3. **Backup enne suurt muudatust** — `wrangler d1 export list-parking-log
   --remote --output=backup-YYYY-MM-DD.sql`.
4. **Tee migration enne function deploy'd** — kui Function ootab uut veergu,
   aga see veel D1-s puudub, parkimised hakkavad ebaõnnestuma.

## Kuluinfo

D1 Free plan: 5 GB salvestust, 5 mln rida loetud / 100k rida kirjutatud päevas
(rohkem kui vaja). 1 parkimine = ~1 KB → ~5 mln parkimist Free plan'i mahub.
