# Transkripsjonsfunn — leverandørevaluering

**Mål:** Velge tale-til-tekst-leverandør for Brave CallAI basert på **norsk kvalitet, latency og pris**. Azure (nåværende) er «grei» men krever Claude-rydding av grammatikk/staving — vi leter etter en leverandør som eliminerer det steget.

**Testsett:** 7 ekte cold calls i `lydopptak/` (varierende lydkvalitet). Tidligere kjøringer
brukte én fil (`testopptak1.m4a`, nå slettet) — metrikk-tabellen under er fra den.
**Metrikker:** batch-latency, streaming time-to-first-word (TTF), kost/min, og manuell norsk kvalitet (egennavn, fagord, mening bevart).
**Kriterium:** riktige ord + nøkkelord/egennavn først, grammatikk/casing lavt.

> Harness: `npm run eval-transcribe <fil>` → `eval-results/<dato>/`. Streaming mates i sanntid (100ms/chunk), så hver streaming-kjøring tar ~lydlengden.

## Status

Kvalitetsskår = snitt 1–5 fra **manuell 7-fil-evaluering** (2026-06-17), vektet etter
beslutningskriteriet **riktige ord + nøkkelord/egennavn først, grammatikk/casing lavt**
(se egen seksjon under). Full matrise: `eval-results/2026-06-17/SAMMENDRAG.md`.

| Provider | Batch | Streaming | Kvalitet (1–5) | Verifisert |
|---|---|---|---|---|
| AWS Transcribe | ✅ | ✅ | **4.00 — best** på ord/egennavn | **Ja** (0/7 feil) |
| Azure (nåværende) | ✅ | ✅ | **3.43 — ekte nr. 2** (egennavn ofte småskrevet, men riktig ord) | **Ja** (0/7 feil) |
| Deepgram (nova-3) | ✅ | ✅ | 2.57 — ekte egennavnsfeil + tall-bom | **Ja** (0/7 feil) |
| Google Chirp | ⚠️ <1 min | ✅ | 1.71 — hallusinerer egennavn, kollapser på støy | Delvis (batch >1 min krever GCS) |
| OpenAI Whisper | kode klar | n/a | — | ❌ parkert (egne penger) |

## Metrikk (gammel enkeltfil — aggregert 7-fil-metrikk i `eval-results/2026-06-17/SAMMENDRAG.md`)

| Provider | Batch (ms) | Streaming TTF (ms) | Kost/min | 200 kall/mnd à 5 min |
|---|---|---|---|---|
| Azure | 2 940 | 1 916 | $0.0170 | $17.00 |
| AWS Transcribe | 43 365 | 1 767 | $0.0240 | $24.00 |
| Deepgram (nova-2) | 2 776 | 4 250 | $0.0059 | $5.90 |
| Deepgram (nova-3) | 2 262 | 4 532 | $0.0059 | $5.90 |
| Google Chirp | — | — | $0.0160 | $16.00 |
| OpenAI Whisper | — | — | $0.0060 | $6.00 |

## 7-fil-evaluering (2026-06-17) — manuell kvalitetsskåring

Utvidet fra én testfil til **7 ekte cold calls** med varierende lydkvalitet (ren lyd,
kafeteria/musikk, pub-støy, manus). Hver fil fikk en håndskrevet fasit; kvalitet skåret
1–5 per fil × provider. Harness måler kun latency/pris — kvalitet er manuell.

**Beslutningskriterium (avklart):** *riktige ord + nøkkelord/egennavn teller mest;
grammatikk og store bokstaver lavt.* En tekst som er uryddig men ordrett korrekt er OK —
Claude kan rydde grammatikk, men ikke gjette riktig egennavn/tall.

**Snitt 1–5:** AWS **4.00** > Azure **3.43** > Deepgram **2.57** > Google **1.71**.

To skjevheter i de automatiske WER-tallene (`eval-results/2026-06-17/WER.md`) er
korrigert for i den manuelle skåren:
1. **Alle fasiter ble seedet fra AWS sitt utkast** → AWS sin WER er optimistisk (delvis
   sirkulær). AWS er rabattert på de tyngste filene; fortsatt best, men ikke feilfri
   (bommet «Markus»→«Morkus/Meatlke», hallusinerte «AirPay»).
2. **WER straffer opprydding** av fyllord — irrelevant her siden grammatikk er lavt vektet.

**Nøkkelfunn om Azure:** auto-nøkkelordmatrisa (`<slug>/nokkelord.md`) undervurderte Azure
fordi den teller store forbokstaver. Ved lesing av faktiske transkripter er Azures egennavn-
«bom» nesten utelukkende **casing/spacing** («cuba», «h. m. s.», «e. r. p.», «a. s.») —
*riktige ord*, stygt formatert. Azure fanget Cuba, Markus, Berge, bedriftshelsetjeneste, HMS,
Arbeidstilsynet, ERP, Morten, 100, 3990. Under kriteriet (ord > grammatikk) er Azure derfor
en reell nr. 2. Ekte Azure-feil: navn (Kristian→«Kristin», Markus→«Marcus»), sammensmeltinger.

## Funn per leverandør

### AWS Transcribe — best kvalitet
- Korrekte egennavn («Brave Media», «Elkjøp»), naturlig «OK» og klokkeslett. Minst behov for Claude-rydding.
- Beste streaming-TTF (~1,8s).
- **Svakhet:** ingen ekte rask-batch uten S3 — vår «batch» går via streaming og tar ~43s (nesten lydlengden). Relevant for «hjelp etter samtale»-flyten.
- **Dyrest** ($24/mnd).
- Språkkode: `no-NO` (ikke `nb-NO`).

### Azure — solid allrounder (nåværende)
- Treffer mening godt, men kosmetiske feil: «o. k.» i stedet for «OK», småfeil i grammatikk → krever Claude-rydding (selve motivasjonen for evalueringen).
- Klart raskest batch (~3s) og god TTF (~1,9s).
- Midt på pris ($17/mnd).

### Deepgram — billigst; nova-3 løfter batch-kvaliteten markant
- **nova-2 (gammel):** mening-endrende feil — «beslutningstaker»→«budsjettering», «prospekting» droppet, egennavn rotet. Diskvalifiserende.
- **nova-3 (ny):** fikser de verste batch-feilene — «beslutningstaker» ✅ og «prospekting» ✅ nå korrekte. Batch-kvalitet **nær AWS** til ¼ av prisen, og rask batch (2,3s vs AWS 43s).
- **Gjenstående svakheter (nova-3):**
  - Egennavn fortsatt feil: «Braie/Breva Media» (Azure/AWS treffer «Brave Media»). Deepgrams svakhet på norsk — men kan ryddes av Claude med kontekst fra notater.
  - Streaming svakere enn batch («beslutningstaker»→«puslespillsdager») og **TTF 4 532 ms** — ~2,5× tregere enn Azure/AWS.
- **Vurdering:** batch nova-3 er nå en reell kandidat (kvalitet/pris). Streaming: nei.

## Konklusjon (etter 7-fil-evaluering)

**Rangering på kvalitet (ord/egennavn): AWS 4.00 > Azure 3.43 > Deepgram 2.57 > Google 1.71.**

- **AWS Transcribe** — best råkvalitet på ord og egennavn, også under støy. Pris: dyrest
  ($24/mnd) + treg batch (~35s, via streaming uten S3). Velg hvis siste kvalitetsnivå på
  egennavn er kritisk og kost/latency er akseptabelt.
- **Azure (nåværende) — anbefalt å beholde.** Reell nr. 2 under kriteriet (riktige ord >
  grammatikk): fanger de fleste ord/egennavn, feilene er mest casing/formatering som Claude
  rydder. Billigere enn AWS ($17), klart raskest batch (~3s), og **allerede integrert** — ingen
  migreringskost. Svakhet: enkelte navnefeil under støy.
- **Deepgram nova-3** — billigst ($5,90)/rask, men taper på det som teller her: **ekte**
  egennavnsfeil (Kua/KUB/Berger/Darrasa, «Meet-enke») og tall-bom («15 til 7»). Vinner kun
  på pris/fart, ikke kvalitet. Batch > streaming (streaming svakere + TTF ~4,5s).
- **Google Chirp — park.** Lavest kvalitet (hallusinerer egennavn, kollapser på støy) og
  batch >1 min krever GCS-plumbing som ikke er bygget.
- **OpenAI Whisper** — ikke testet (krever egne penger); lav prioritet gitt resultatene over.

**Anbefaling:** behold **Azure** gitt kriteriet, kostnaden og at den er integrert. Vurder
**AWS** kun hvis egennavn-presisjon under støy viser seg kritisk i produksjon. **Neste steg:**
bekreft med et par ekte samtaler i produksjonslydkvalitet før et eventuelt bytte.

## Gotchas (løst i koden)
- Streaming **må** mates i sanntid (100ms/chunk) — raskere mating avkutter transkript og fikk Azure til å henge på `EndOfStream`.
- `@deepgram/sdk` pinnet til v3 (v5 er regenerert API uten `createClient`/`listen.live`).
- AWS språkkode er `no-NO`, ikke `nb-NO`.
- Google synkron batch (`recognize`) har 60s-grense; testfila er ~80s → bruk <60s-klipp for Google batch (streaming tåler full lengde).
