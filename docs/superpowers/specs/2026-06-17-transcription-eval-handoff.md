# Transkripsjonsevaluering — Handoff / Status

**Sist oppdatert:** 2026-06-17
**Branch:** `main` (bli her).
**Erstatter:** `2026-06-16-transcription-eval-handoff.md` (utdatert — denne er fasit).

## Hva dette er
Evaluering av tale-til-tekst-leverandører for Brave CallAI for å velge leverandør basert på
**norsk transkripsjonskvalitet, latency og pris**. Motivasjon: Azure (nåværende, nb-NO) er «grei»
men krever Claude-etterrydding av grammatikk/staving — målet er en leverandør som eliminerer det steget.

## Relaterte dokumenter
- **Funn (levende konklusjon):** `docs/transcription-findings.md`
- **Design/spec:** `docs/superpowers/specs/2026-06-16-transcription-evaluation-design.md`
- **Implementasjonsplan:** `docs/superpowers/plans/2026-06-16-transcription-evaluation.md`
- **Harness + bruksanvisning:** `scripts/eval-transcription/` (+ `README.md`)
- **Resultater fra siste kjøring:** `eval-results/2026-06-17/` (7 filer + `SAMMENDRAG.md`)

## Slik kjører du (oppdatert harness)
```bash
npm run eval-transcribe lydopptak/                 # hele mappa
npm run eval-transcribe fil1.m4a fil2.webm         # utvalgte filer
```
- Hver fil får `eval-results/<dato>/<filnavn>/report.md` (+ `raw.json`).
- Ved 2+ filer skrives også `eval-results/<dato>/SAMMENDRAG.md` (aggregert metrikk + tom kvalitetsmatrise).
- **Kjør på mappa, ikke enkeltfil med `ø` i navnet** — å skrive `ø` selv treffer en NFC/NFD-normaliseringsbug; mappemodus henter navnene fra filsystemet og unngår det.
- Streaming mates i sanntid (100ms/chunk) → hver streaming-kjøring tar ~lydlengden. Per fil ~5 sanntids-gjennomløp, så 7 filer tar en god stund. **Det finnes ufullførte effektiviserings-idéer (`--batch-only`, `--parallel`)** — se «Mulige forbedringer».

## Status per leverandør (etter 7-fil-kjøring 2026-06-17)

| Provider | Batch | Streaming | Verifisert | Pris (200 kall/mnd) |
|---|---|---|---|---|
| Azure | ✅ ~3s | ✅ | **Ja** (0/7 feil) | $17 |
| AWS Transcribe | ✅ men treg (~35s, via streaming) | ✅ best TTF (~1,9s) | **Ja** (0/7 feil) | $24 (dyrest) |
| Deepgram (nova-3) | ✅ ~4s | ✅ | **Ja** (0/7 feil) | $5,90 (billigst) |
| Google Chirp | ⚠️ kun <1 min (se under) | ✅ (7/7 OK) | Delvis | $16 |
| OpenAI Whisper | ❌ ikke testet (parkert) | n/a | Nei | $6 |

### Google: viktig batch-begrensning (nytt funn)
- **Streaming funker fullt** på alle 7 filene.
- **Batch feiler på alle filer >1 min** med `INVALID_ARGUMENT: Inline audio exceeds duration limit`.
  `longRunningRecognize` med **inline** content har samme ~1-min-grense som sync `recognize` —
  inline base64 er capet uansett. Lengre lyd krever **GCS-uri** (last opp til Google Cloud Storage
  først). Kort sagt: Google batch på ekte samtaler (>1 min) krever GCS-plumbing som IKKE er bygget.
  Avgjørelse gjenstår: trenger vi Google batch i det hele tatt, eller holder streaming?

### OpenAI: parkert
Krever egne penger (ingen gratis-kreditt, kort+credit). `OPENAI_API_KEY` ikke lagt inn. Feiler pent 7/7.

## NESTE STEG (det viktigste først)
1. **Fyll inn kvalitetsmatrisen manuelt** i `eval-results/2026-06-17/SAMMENDRAG.md` (1–5 per fil × provider).
   Les hver `report.md` og skår norsk kvalitet (egennavn, fagord, mening bevart). **Dette er
   beslutningsdriveren** — harnessen måler latency/pris automatisk, men IKKE kvalitet (ingen AI i
   rapportgenereringen, kun strengformatering).
2. Når matrisen er fylt: oppdater `docs/transcription-findings.md` med konklusjon og velg leverandør.
3. Vurder om Azure skal byttes ut i `lib/transcribe.ts` (batch) / Speech SDK-flyten (live).
4. (Valgfritt) Avgjør Google batch: bygg GCS-vei, eller dropp Google hvis streaming-only ikke holder.
5. (Valgfritt) Skaff `OPENAI_API_KEY` hvis Whisper fortsatt er interessant (billig, kun batch).

## Foreløpige funn (fra `docs/transcription-findings.md`)
- **AWS** = best kvalitet (korrekte egennavn, naturlig), men dyrest + treg batch.
- **Azure** = solid allrounder, men løser ikke rydde-problemet (kosmetiske feil som «o. k.»).
- **Deepgram nova-3** = overraskelsen: batch-kvalitet nær AWS, rask, billigst. Svakhet: egennavn
  («Brave Media» → «Braie Media») + svakere/tregere streaming. nova-3 fikset nova-2s verste feil
  («beslutningstaker», «prospekting»).

## Google-auth (lokal eval vs. produksjon)
- **Lokalt nå:** ADC via `gcloud auth application-default login` (org blokkerer service-account-
  JSON-nøkler via policy `iam.disableServiceAccountKeyCreation`). `GOOGLE_APPLICATION_CREDENTIALS`
  i `.env.local` peker på `~/.config/gcloud/application_default_credentials.json`.
- **GOTCHA — `invalid_rapt`:** ADC-tokenet krever periodisk reauth (org-policy) og utløper (typisk
  over natta). Får du `invalid_rapt`, kjør `gcloud auth application-default login` på nytt.
- **Produksjon:** ville brukt **Workload Identity Federation (nøkkelfri)** — Vercel OIDC →
  GCP, auto-refresh, ingen reauth, ingen nøkkel å lekke. Ikke bygget (kun relevant hvis Google velges).

## Gotchas (allerede løst i koden — ikke gjeninnfør)
- **Streaming MÅ mates i sanntid (100ms/chunk).** Raskere mating avkutter transkriptet OG fikk Azure
  til å henge på `EndOfStream`. Løst med guardet `finish()` i `providers/azure.ts`.
- **Google streaming:** config sendes via **konstruktør-argumentet** til `streamingRecognize()`, og
  lyd skrives som **rå buffere** (ikke `{ audioContent }`-objekter — streamen dobbelt-wrapper dem →
  «Malordered Data Received»). Rettet i `providers/google.ts`.
- **`@deepgram/sdk` pinnet til v3** (v5 er regenerert API uten `createClient`/`listen.live`). Modell `nova-3`.
- **AWS språkkode `no-NO`** (ikke `nb-NO`).
- **`ffmpeg-static` har ikke `ffprobe`** — varighet måles via `wavDurationSec` etter konvertering.

## Mulige forbedringer (ikke bygget)
- **`--batch-only`-flagg:** hopp over streaming for raskt kvalitetssveip (~1× lydlengde i stedet for
  ~5×). Streaming-kvalitet ≈ batch-kvalitet, og latency er allerede karakterisert. Største tidsgevinst.
- **`--parallel`-flagg:** kjør filer samtidig (krever async ffmpeg — `toWav` bruker `spawnSync` som
  blokkerer event-loopen). Nøkler tåler samtidige requests; problemet er kun målepresisjon + sync-kode.

## UCOMMITTET (per 2026-06-17)
- `scripts/eval-transcription/providers/google.ts` — Google-fiksene (batch `longRunningRecognize`,
  streaming config/buffer). **Eier pushet dette selv.** Ikke relatert til no-audio-arbeidet.
- `lydopptak/*` — 7 nye testopptak (varierende lydkvalitet) lagt til; `testopptak1.m4a` +
  `MarkusTest.webm` slettet. `eval-results/` er gitignorert (men inneholder ekte salgskall-transkripter
  — vurder om de bør ligge lokalt vs. ikke).
