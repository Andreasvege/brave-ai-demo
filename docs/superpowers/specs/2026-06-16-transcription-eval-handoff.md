# Transkripsjonsevaluering — Handoff / Status

**Sist oppdatert:** 2026-06-16
**Branch:** alt ligger på `main` (eget arbeid merget via `6c5c2cd`, arbeidsbranchen slettet). Bli på `main`.

## Hva dette er
Evaluering av tale-til-tekst-leverandører for Brave CallAI for å velge leverandør basert på **norsk transkripsjonskvalitet, latency og pris**. Motivasjon: Azure (nåværende, nb-NO) er «grei» men krever Claude-etterrydding av grammatikk/staving — målet er en leverandør som eliminerer det steget.

## Relaterte dokumenter
- **Design/spec:** `docs/superpowers/specs/2026-06-16-transcription-evaluation-design.md`
- **Implementasjonsplan:** `docs/superpowers/plans/2026-06-16-transcription-evaluation.md`
- **Harness + bruksanvisning:** `scripts/eval-transcription/` (+ `README.md` der)

## Slik kjører du
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Resultat skrives til `eval-results/<dato>/report.md` (lesbar) + `raw.json`.
Streaming mates i sanntid (100ms/chunk), så hver streaming-kjøring tar ~like lang tid som lydfila (~80s for testfila). Forventet.

## Status per leverandør

| Provider | Batch | Streaming | Verifisert? |
|---|---|---|---|
| Azure | ✅ | ✅ | **Ja** — ekte transkript, begge moduser |
| AWS Transcribe | ✅ | ✅ | **Ja** — `no-NO` funker, ingen språkfeil |
| Google Chirp | kode klar | kode klar | ❌ venter på `GOOGLE_APPLICATION_CREDENTIALS` |
| OpenAI Whisper | kode klar | n/a (kun batch) | ❌ venter på `OPENAI_API_KEY` |
| Deepgram | kode klar | kode klar | ❌ venter på `DEEPGRAM_API_KEY` |

Providers uten nøkler feiler pent med «… mangler» i rapporten; resten kjører videre.

## Funn så langt (Azure vs AWS på testfila)
- **Kvalitet:** AWS leverer subjektivt renere norsk (korrekte egennavn «Brave Media»/«Elkjøp», «OK» vs Azures «o. k.», naturlig klokkeslett) — trolig mindre behov for Claude-rydding. Azure er en god allrounder.
- **Latency:** Streaming TTF jevnt (Azure ~1,9s, AWS ~1,7s). **Batch: Azure ~3s vs AWS ~46s** — AWS har ingen ekte rask-batch uten S3, så vår «batch» går via streaming og tar nesten like lang tid som lydfila. Relevant for «hjelp etter samtale»-flyten.
- **Pris (200 samtaler/mnd à 5 min):** Azure $17 · AWS $24 (dyrest) · Google ~$16 · Whisper ~$6 · Deepgram ~$5,90.
- **Foreløpig:** AWS vinner kvalitet/TTF, taper batch-latency + pris. De billige (Whisper, Deepgram) gjenstår — hvis en matcher AWS-kvalitet til brøkdel av prisen, blir det interessant.

## Neste steg
1. Skaff API-nøkler for Google, OpenAI, Deepgram → legg i `.env.local`.
2. **Google batch:** synkron `recognize` har 60s-grense; testfila er ~80s, så klipp et <60s-utdrag for Google batch (Google streaming tåler full lengde).
3. Kjør `npm run eval-transcribe` på nytt → fyller hele tabellen.
4. Verifiser hver nye provider: ikke-tomt norsk transkript, fornuftig TTF/pris.
5. Når alle er verifisert: velg leverandør, og vurder å bytte ut Azure i `lib/transcribe.ts` (batch) / Speech SDK-flyten (live).

## Gotchas (allerede løst i koden — ikke gjeninnfør)
- **Streaming MÅ mates i sanntid (100ms/chunk).** Raskere mating avkutter transkriptet OG fikk Azure til å henge på `EndOfStream`. Løst med guardet `finish()` i `providers/azure.ts`.
- **`@deepgram/sdk` er pinnet til v3.** v5 er en regenerert SDK (`DeepgramClient` + `listen.v1/v2`) uten `createClient`/`listen.live`.
- **AWS språkkode `no-NO` funker** (ikke `nb-NO`) — bekreftet.

## Repo-merknader
- `eval-results/` er gitignorert men ble likevel sporet (committet i mergen) og inneholder **ekte salgskall-transkripter**. Vurder `git rm --cached -r eval-results/` hvis det ikke bør ligge i historikken.
- **Urelatert åpent punkt:** sikkerhets-review flagget «funn 2» (blob-opplasting `addRandomSuffix: false` lar et teammedlem overskrive en annens lyd) — fortsatt åpent på main, IKKE en del av eval-arbeidet. Egen handoff-prompt finnes for det.
