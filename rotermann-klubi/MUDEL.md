# ROTERMANNI KLUBI — Wallet + CompuCash mudel (ilma pangakaardita)

Kuupäev: 10.11.2026  
Seotud lehed: live ülevaade ja simulaator **`https://list.ee/rotermann-klubi/`** (lokaalne koopia `Rotermanni_klubi_ilma_kaardita.html`), võrdluseks senine kaardimudel `https://list.ee/staatus/` (`Rotermanni_arvutuskaik.md`).

---

## 1. Miks see mudel sündis (61 koha POS-kaardistuse järeldus)

Rotermanni 61 ettevõtte kassasüsteemide kaardistus näitas, et kvartali igapäevane korduvkäive ei ole killustunud:

- **32 söögi- ja joogikohast 25 (78%) kasutavad CompuCashi** — sh R14, Platz, PULL, Bruxx, FLAMM, Levier, Chicago 1933, Taqueria, Orangerie, Pühaste Taproom, Gallery Cafe, Stalker, Siesta, Bali, Jenk BBQ, Mnemonic Bar, Viru Burger, Captain Roosters, Time to Wine, Nomade, Fume, Gobi, La Bocca ja St Patrick.
- Koos PoCo muuseumi, Millenia Pesupoe, Hairline'i ja SunLabiga on kvartalis **29 CompuCashi kassat**.
- Veel **3 igapäevast söögikohta** kasutavad avatud REST API-ga pilvekassasid: **Sanga** ja **Whippet** (`Spindl OS`) ning **Röst** (`Square`).
- Killustunud süsteemid (`ERPLY`, `Shopify POS`, `Directo`, `Salon Infra`, `Excel`, käsikassa) asuvad valdavalt butiikides ja salongides, kus ostusagedus on harv ja kuhu kassaliidest ehitada ei ole vaja.
- Samal ajal on kvartalis juba olemas **Sharry-põhine Rotermanni äpp** (~3 400 töötajat digivõtme ja parkimisega) ning `list.ee` Cloudflare Pages + D1 taristu.

**Järeldus:** Wallesteri pangakaardi + Apple Pay (17 575 €) + EveryPay (0,7%) lahendus kulutab 1 000 liikme juures esimesel aastal **58 460 €** ainuüksi kaardirööpale, mille ainus ülesanne on tuvastada kassas liige ja liigutada kliendi raha topelt. Apple/Google Walleti kliendikaart + CompuCashi liides teeb sama töö ära **0 € ostupõhise maksekuluga** ja **ilma e-raha / makseasutuse tegevusloa riskita**.

---

## 2. Kuidas kliendi teekond töötab (5 sammu)

1. **Kaardi lisamine (üks kord, 15 sekundit):**
   - Rotermanni töötaja avab olemasoleva **Rotermanni äpi (`Sharry`)**, vajutab *„Rotermanni Klubi”* (`list.ee` WebView tuvastab kasutaja automaatselt) ja vajutab **„Lisa Apple / Google Walletisse”**.
   - Külaline väljastpoolt skannib laualt QR-koodi, vormistab `list.ee` lehel liikmelisuse (kampaania ajal 0 €, edasi 4,75 €/kuu) ja lisab kaardi Walletisse.
   - Kaart avaneb telefonis täpselt samast kohast kus pangakaart (topeltklõps küljenupul) ja näitab reaalajas **Rotermanni raha saldot (€)**.

2. **Kogumine letikassas (nt Levier, CompuCash):**
   - Klient näitab letil Walleti QR-koodi CompuCashi 2D-skannerile (või iPad-kassa kaamerale) → CompuCash seob arve kliendiga (0 lisaklikki teenindajale).
   - Klient maksab arve täishinnas **oma tavalise pangakaardiga** otse restorani makseterminali.
   - CompuCash saadab arve info API kaudu `list.ee` arvestusraamatusse → kliendi Walleti saldo kasvab 2 sekundiga **+10%** võrra.

3. **Kogumine lauateeninduses (nt Platz, CompuCash — kelner ei jookse leti taha):**
   - Kuna boonuse kogumisel **arve summa ei muutu**, prindib CompuCash tavalise eel-tšeki jalusesse **ühekordse arve-QR-koodi** (*„Skanni → +4,80 € Rotermanni kontole”*).
   - Kelner võtab makseterminaliga täissumma vastu nagu igal tavalisel laual ja liigub edasi.
   - Klient skannib lauas ise telefoni kaameraga tšeki QR-i → `list.ee` kontrollib CompuCashi API-st, et arve on makstud ja varem skannimata → boonus laekub kohe Walletisse. *(Alternatiivina saab kelner CC5 mobiilikassaga kliendi Walleti ka lauas skannida.)*

4. **Kohad väljaspool CompuCashi (nt Röst, Kalve, butiigid):**
   - Klient näitab täpselt sama Walleti kaarti.
   - Röstis / Kalves skannib teenindaja iPadis/telefonis `list.ee` partnerivaates kliendi QR-i ja sisestab summa (3 sekundit) — või ühendatakse Square/Spindl webhook otse `list.ee`-ga.
   - Harva külastatavates poodides ja salongides võib Walleti kaardi ettenäitamisel rakendada kohest `-10%` klubisoodustust ilma arvelduseta.

5. **Kogutud raha kulutamine (nt reede õhtu R14-s):**
   - Arvet küsides ütleb klient: *„Kasutan Rotermanni raha”* ja näitab Walleti kaarti (QR või lühike 5-kohaline kood, nt `842-19`).
   - `list.ee` hoiab aktiivset boonussaldot CompuCashide vahel API-ga sünkroonis → R14 kassa näeb kohe kliendi saldot (nt `20,80 €`).
   - Teenindaja vajutab CompuCashis **„Boonusmakse (−20,80 €)”** ja makseterminal küsib kliendi pangakaardilt ainult jäägi (`65,00 € − 20,80 € = 44,20 €`). Walleti saldo nullitakse koheselt.

---

## 3. Restorani vaade ja kuu lõpu automaatne tasaarveldus (Clearing)

Kuu jooksul ei käi mitte ükski kaardimakse läbi The Listi — restoran saab iga ostu raha otse oma panka oma olemasoleva terminali lepinguga.

Kuu lõpus teeb `list.ee` ühe automaatse tasaarvelduse:

$$\text{Restorani kuu saldo} = \text{Välja teenitud 10\% boonused} - \text{Selles restoranis lunastatud boonused} + \text{Platvormitasu (nt 0\% või 2\%)}$$

- **Näide A (`Platz` — lõunakoht, netoväljastaja):** Kuu jooksul teenisid liikmed Platzis `1 200 €` boonust, kohapeal maksid nad boonusega `750 €`. Platz andis kassast välja `450 €` vähem soodustust, kui tema käibelt tekkis → The List esitab Platzile kuu lõpus ühe koondarve **`450 €`** (+ kokkulepitud platvormitasu).
- **Näide B (`R14` — õhturestoran, netolunastaja):** Kuu jooksul teenisid liikmed R14-s `900 €` boonust, aga reedeti kulutasid nad seal teistes kohtades kogutud boonust `1 350 €` eest → **The List maksab R14-le kuu lõpus `450 €` kinni** (Platzi jt netoväljastajate maksetest).
- **Null likviidsusriski:** Kuna lunastada ei saa kunagi rohkem boonust, kui kvartalis on välja teenitud (ja ~15% saldost aegub 12 kuuga ehk *breakage*), on kliiringukonto alati rahaliselt plussis.

---

## 4. Kulude ja tasuvuse võrdlus (1 000 liiget, 70% aktiivsed, 87 500 € GMV/kuu)

Võrdlus samadel `STRATEEGIA.md` / `list.ee/staatus` eeldustel (liikmetasu 4,75 € koos KM-ga = 3,83 € netos; eraldi tegevuskulu 4 400 €/kuu):

| Näitaja | Pangakaart (Wallester + Apple Pay) | Wallet + CompuCash + Äpp | Vahe The Listi kasuks |
|---|---:|---:|---:|
| **Käivitus ja ehitus (ühekordne)** | 65 575 € | **22 000 €** | **−43 575 €** |
| sh välised setup-tasud (Wallester + Apple Pay) | 21 575 € | **0 €** (99 $/a Apple Dev) | **−21 575 €** |
| **Igakuine tehnoloogiakulu (1 000 liiget)** | 3 279 € / kuu | **381 € / kuu** | **−2 898 € / kuu** |
| **Kuu tulemus (4,75 €/kuu · resto 0%)** | −3 279 € / kuu | **−951 € / kuu** | **+2 328 € / kuu** |
| **Kuu tulemus (4,75 €/kuu + 2% resto)** | −1 529 € / kuu | **+799 € / kuu** | **+2 328 € / kuu** |
| **Nullpunkt (ainult 4,75 €/kuu)** | 2 051 liiget | **1 224 liiget** | **−827 liiget** |
| **Nullpunkt (4,75 €/kuu + 2% resto)** | 1 314 liiget | **863 liiget** | **−451 liiget** |
| **1. aasta kogutulemus (2 tasuta + 8 tasulist kuud)** | −118 928 € | **−47 183 €** | **+71 745 €** |

*Märkus:* Kui programmi hallatakse The Listi olemasoleva Rotermanni äpi tiimiga (`~1 500 €/kuu` lisakulu eraldi `4 400 €/kuu` tiimi asemel), on Wallet + CompuCash mudel **juba 1 000 liikmega +1 949 €/kuu kasumis** (nullpunkt **494 liiget**, koos +2% resto tasuga **337 liiget**).

---

## 5. Ehituse eelarve ja jooksvad kulud (Wallet + CompuCash mudel)

### Ühekordne käivitus (~22 000 €)
1. **Apple & Google Wallet Pass mootor + Sharry WebView liitumisvoog (`list.ee`):** ~6 000 €
2. **CompuCash 5 API sünk (liikmed, arved, boonussaldo, tšeki-QR) + mitte-CC partnerivaade:** ~9 000 €
3. **Kuu lõpu kliiringumootor ja restorani raportivaade:** ~3 000 €
4. **Avamismaterjalid, laua-QR-id ja kassade seadistustugi:** ~4 000 €

### Igakuine tehnoloogiakulu (~310 € baas + kuutasu maksevahendus)
1. **Apple Developer + Google Wallet API:** ~10 € / kuu (Apple Dev 99 $/a, Google Wallet 0 €)
2. **Cloudflare Pages / Workers / D1, e-arved ja monitooring:** ~150 € / kuu
3. **CompuCash API liideste hooldusvaru:** ~150 € / kuu
4. **4,75 € kuutasude kogumine (Stripe / EveryPay ~1,5% ainult kuutasudelt):** ~0,07 € maksva liikme kohta kuus

---

## 6. Kaks tehnilist kontrollküsimust Ektacole (CompuCash)

Enne arenduse lukustamist kinnitada Ektaco tiimiga (`sales@ektaco.ee`):

1. **Kvartaliülene kliendikaart ja saldo API:** Kas `CompuCash 5` API võimaldab `list.ee`-l automaatselt sünkroonida sama Walleti kliendikaardi numbri ja jooksva `boonussaldo` 29 Rotermanni ettevõtte CompuCashi andmebaasi (lugeda arveid ja kirjutada uuendatud saldot)?
2. **Ühekordne QR eel-tšekil:** Kas CompuCashi tšekimallile saab trükkida dünaamilise arve-ID lingiga QR-koodi, et lauateeninduses saaks klient boonuse sisse skannida ka pärast tšeki lauda toomist ilma kelneri lisaliigutuseta?
