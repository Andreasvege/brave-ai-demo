# Transkripsjonsleverandør-evaluering — Design

**Dato:** 2026-06-16
**Status:** Godkjent
**Kontekst:** Brave CallAI transkriberer selgerens side av salgskall. Vi bruker i dag Azure Speech Fast Transcription (nb-NO, westeurope). Resultatkvaliteten er brukbar, men krever Claude-etterbehandling for å rydde opp i grammatikk og stavefeil — noe vi ønsker å eliminere ved å velge riktig leverandør fra start.

---

## Mål

Gjennomføre en faktabasert evaluering av de store tale-til-tekst-leverandørene på **kvalitet** og **pris**, slik at vi kan ta et informert valg før vi binder oss til arkitektur for live-transkripsjonstøtte.

---

## Kandidater

| Provider                    | Batch                                 | Streaming           | Norsk kode |
|---                          |---                                    |---                  |         ---|
| Azure Speech (nåværende)    | ✅ Fast Transcription REST            | ✅ WebSocket SDK    | `nb-NO`   |
| AWS Transcribe              | ✅ via streaming API (unngår S3)      | ✅ HTTP/2 streaming | `no-NO`   |
| Google Cloud Speech (Chirp) | ✅ direkte upload (≤60s) / GCS (>60s) | ✅ gRPC streaming   | `nb-NO`   |
| OpenAI Whisper              | ✅                                    | ❌                  | `no`      |
| Deepgram                    | ✅                                    | ✅ WebSocket        | `nb`      |

---

## Avgrensninger

- **Dataplassering:** Kun selgerens stemme transkriberes — ikke kunden. Ansattdata er fortsatt persondata under GDPR, men alle store leverandører tilbyr DPA med Standard Contractual Clauses. Strenge EU-krav gjelder ikke.
- **Scope nå:** Batch er prioritet (hjelp etter samtale). Live er fremtidig krav og inngår i evalueringen, men implementeres i applikasjonen i et separat steg.
- **Ikke i scope:** Integrasjon i Next.js-appen, A/B-testing i produksjon, speaker diarization.

---

## Arkitektur

Frittstående evalueringsskript i `scripts/eval-transcription/` — ingen delte avhengigheter med Next.js-appen. Kjøres manuelt med `tsx`.

```
scripts/eval-transcription/
  index.ts            ← main: laster lydfil, kjører alle providers, genererer rapport
  types.ts            ← BatchResult, StreamingResult, ProviderReport
  audio.ts            ← konverterer m4a → WAV 16kHz/16-bit/mono via ffmpeg-static
  providers/
    azure.ts          ← batch (REST) + streaming (SDK)
    aws.ts            ← streaming API (unngår S3-krav; brukes for begge moduser)
    google.ts         ← batch (direkte upload ≤60s, fallback GCS) + streaming (gRPC)
    openai.ts         ← batch only (Whisper)
    deepgram.ts       ← batch + streaming (WebSocket)
  report.ts           ← skriver Markdown + JSON til eval-results/
```

**Kjøring:**
```bash
tsx scripts/eval-transcription/index.ts lydopptak/testopptak1.m4a
```

---

## Streaming-strategi

`m4a` er et containerformat og støttes ikke direkte av streaming-APIer. Løsning:

1. Konverter lydfilen til WAV (16kHz, 16-bit, mono) ved oppstart via `ffmpeg-static`
2. Chunk WAV i 100ms-biter
3. Send biter sekvensielt til hvert streaming-API (sekvensielt mellom providers for å unngå rate limits)
4. Mål tid til første ord (TTF) og total fullføring

---

## Typer

```typescript
type BatchResult = {
  transcript: string;
  durationMs: number;
  error?: string;
};

type StreamingResult = {
  transcript: string;
  timeToFirstWordMs: number;
  totalDurationMs: number;
  error?: string;
};

type ProviderReport = {
  name: string;
  batch?: BatchResult;
  streaming?: StreamingResult;
  costPerMinuteUSD: number;
};
```

---

## Nye pakker (dev-avhengigheter)

```bash
npm install --save-dev tsx dotenv ffmpeg-static @aws-sdk/client-transcribe-streaming @google-cloud/speech @deepgram/sdk openai
```

---

## Miljøvariabler

Utover eksisterende Azure-nøkler (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`):

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
GOOGLE_APPLICATION_CREDENTIALS   ← sti til service account JSON
OPENAI_API_KEY
DEEPGRAM_API_KEY
```

Legges i `.env.local` (skriptet bruker `dotenv` for å laste disse).

---

## Output

Rapport skrives til `eval-results/YYYY-MM-DD/`:

**`report.md`** — menneskelig lesbar sammenligning:
```markdown
# Transkripsjonsevaluering — 2026-06-16
Lydfil: testopptak1.m4a (X min Y sek)

## Metrikk-oversikt
| Provider       | Batch (ms) | Streaming TTF (ms) | Kost/min (USD) |
|----------------|------------|---------------------|----------------|
| Azure          | ...        | ...                 | $0.017         |
| AWS Transcribe | ...        | ...                 | $0.024         |
| Google Chirp   | ...        | ...                 | $0.016         |
| OpenAI Whisper | ...        | —                   | $0.006         |
| Deepgram       | ...        | ...                 | $0.0059        |

## Transkripter (batch)
### Azure
> "..."
### AWS
> "..."
...

## Transkripter (streaming)
...

## Prisberegning
Basert på 200 samtaler/mnd à 5 min: ...
```

**`raw.json`** — fullstendige rådata for videre analyse.

---

## Suksesskriterier

- Alle providers kjører uten feil på testfilen
- Rapporten gir et klart grunnlag for å velge leverandør basert på norsk transkripsjonskvalitet og pris
- Ideelt resultat: én provider som eliminerer behovet for Claude-etterbehandling av transkriptet
