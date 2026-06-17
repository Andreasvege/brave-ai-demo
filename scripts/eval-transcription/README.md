# Transkripsjonsevaluering

Sammenligner Azure, AWS Transcribe, Google Cloud Speech, OpenAI Whisper og
Deepgram på norsk tale-til-tekst — batch og streaming.

## Forutsetninger

- ffmpeg følger med via `ffmpeg-static` (ingen systeminstallasjon nødvendig)
- Nøkler i `.env.local` (se under)

## Miljøvariabler

```
AZURE_SPEECH_KEY, AZURE_SPEECH_REGION        # finnes allerede
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
GOOGLE_APPLICATION_CREDENTIALS               # sti til service account JSON
OPENAI_API_KEY
DEEPGRAM_API_KEY
```

Providers uten nøkler hopper over med en feilmelding i rapporten — resten kjører.
**Status nå:** kun Azure-nøkler er på plass. AWS, Google, OpenAI og Deepgram
rapporterer «… mangler» til nøklene legges inn; da verifiserer én kjøring alt.

## Kjøring

```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```

Streaming mates i **sanntid** (100ms per 100ms-chunk), så hver streaming-kjøring
tar omtrent like lang tid som lydfilen. Det gir gyldig TTF og fullstendige
transkripter (rask mating kuttet halen). Forventet for et verktøy som kjøres sjelden.

## Resultat

Skrives til `eval-results/<dato>/report.md` (lesbar) og `raw.json` (rådata).
Resultatmappa er git-ignorert (kan inneholde transkripter).

## Kvalitetsscoring (WER + nøkkelord)

`eval-transcribe` måler kun latency/pris. Kvalitet scores separat — **uten** å
re-transkribere (leser `raw.json`):

```bash
npm run eval-score                      # nyeste eval-results/<dato>/
npm run eval-score eval-results/2026-06-17
```

Den gjør to ting:

1. **WER/CER mot fasit** → `<dato>/WER.md`. Krever en håndskrevet fasit per fil i
   `<dato>/<slug>/fasit.txt`. Mangler den, lages en **stub** seedet med beste
   provider-transkript som utkast. Stubben har en `# TODO`-markør — scoringen hopper
   over fila til du fjerner markøren (ellers gir det uredigerte utkastet falsk 0 % WER).
   Rett utkastet mot lyden. `#`-linjer ignoreres. **Caveat:** WER straffer alle ordfeil
   likt (sammensatte tall/ord matcher ikke perfekt — skriv tall som siffer i fasiten).
2. **Nøkkelord-uenighet** → `<dato>/<slug>/nokkelord.md`. Auto-uttrekk av egennavn/tall,
   med ✓/· per provider, **uenighet øverst**. Fanger egennavn-kvalitet (Cuba/Kuba,
   Brave/Braie) som WER ikke vekter. Trenger ikke fasit — huk av riktig variant manuelt.

Typisk flyt: kjør `eval-transcribe` → `eval-score` (lager stubs + nøkkelord) → rett
fasit-filene → `eval-score` igjen for WER-tall.

## Merknader

- **Deepgram er pinnet til `@deepgram/sdk@^3`** — v5 er en regenerert SDK med et
  annet API (`DeepgramClient` + `listen.v1/v2`). v3 matcher `createClient` /
  `listen.live` / `listen.prerecorded` som koden bruker.
- Azure batch gjenbruker samme Fast Transcription REST-endepunkt som
  produksjonskoden (`lib/transcribe.ts`, api-version 2025-10-15, locale nb-NO).
- Google synkron batch (`recognize`) har 60s-grense. Testfilen er ~80s, så Google
  batch vil feile på den — bruk en kortere fil for Google batch, eller stol på
  Google streaming-resultatet (som ikke har grensen).
