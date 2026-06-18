# Transcription model selector — design

**Dato:** 2026-06-18
**Status:** Godkjent design, klar for implementeringsplan
**Scope:** Demo/research-feature. Lar bruker velge transkripsjonsmodell hands-on i selve
demoen (ikke bare i eval-harnesset), for batch og live.

## Mål

Bygge en modell-velger inn i demoen slik at man kan teste transkripsjonsleverandører i
praksis, ikke bare via standalone-harnesset (`scripts/eval-transcription/`). Konkret:

- **Batch-dropdown:** Azure Speech (nåværende), Azure OpenAI (gpt-4o-transcribe), AWS Transcribe
- **Live-dropdown:** Azure Speech (nåværende), Azure OpenAI Realtime, AWS Transcribe Streaming
- Velgeren lever på `/record`. FAB og PiP arver siste valg som standard.
- Valgt modell lagres per samtale (`transcribeProvider`) og vises som badge på `/calls/[id]`.

Dette holder seg innenfor demo/research-scope: en hands-on utforsking, ikke produktarkitektur.
Endelig leverandørvalg tas fortsatt ved from-scratch-byggingen.

## Valgt tilnærming (A): delt provider-registry + browser-direkte live

Én kilde til sannhet for leverandører. Batch dispatcher server-side; live som browser-direkte
streaming der serveren kun utsteder kortlevd credential. Browser-direkte live unngår
stateful WebSocket på Vercel serverless (som var hovedinnvendingen mot proxy-alternativet).

### Moduloppsett

```
lib/transcription/
  registry.ts          # PROVIDERS-liste + helpers (byMode, byId). Single source of truth.
  types.ts             # ProviderId, TranscribeMode, LiveTranscriber-interface
  batch/
    index.ts           # dispatch(providerId, blob, filename) -> { transcript, durationSec }
    azure.ts           # = dagens lib/transcribe.ts (Azure Fast Transcription)
    azure-openai.ts    # gpt-4o-transcribe (portet fra harnesset)
    aws.ts             # AWS streaming-collect server-side (se note)
  live/                # alle "use client"
    azure-speech.ts    # dagens record/page.tsx live-logikk, bak interfacet
    azure-openai.ts    # Realtime API over WebSocket
    aws.ts             # @aws-sdk/client-transcribe-streaming
```

Registeret er eneste sted som kjenner hele leverandørlista. UI, batch-dispatcher og live-factory
leser alle fra det. Ny leverandør senere = én registry-entry + én modul.

### AWS batch — bevisst forenkling

AWS' ekte batch-API krever S3-bøtte + asynkron polling-jobb (`StartTranscriptionJob`) — tung
infra vi ikke vil legge i en demo. Harnesset har allerede bevist at å **streame fila gjennom
Transcribe i full hastighet server-side** gir samme kvalitet uten S3. `batch/aws.ts` gjenbruker
den streaming-collect-tilnærmingen. Dokumentert som en bevisst forenkling.

## Dataflyt

### Batch (server-side)

```
/record -> last opp lyd til Blob (uendret) -> POST /api/calls { audioUrl, transcribeProvider, ... }
   -> route kaller dispatch(transcribeProvider, blob) -> provider-modul -> transcript
   -> Claude -> DONE
```

Eneste endring i ruten: les `transcribeProvider` fra formdata og send til dispatcheren i stedet
for hardkodet Azure. Alt nedstrøms (Claude, Blob, status) er urørt.

### Live (browser-direkte, samme mønster for alle tre)

```
/record velger provider -> GET /api/transcribe-token/[provider] (server utsteder kortlevd cred)
   -> browser åpner provider-tilkobling direkte, streamer mikrofonlyd
   -> onPartial -> live phrases-UI (uendret) ;  onFinal -> akkumuler transcript
   -> stopp -> POST /api/calls { transcript, transcribeProvider } -> Claude -> DONE
```

Samlende idé: **serveren utsteder kun et kortlevd credential; lydstrømmen går browser->provider
direkte.** Det er slik Azure live allerede fungerer (`/api/speech-token`). Den ene endepunktet
generaliseres til `/api/transcribe-token/[provider]`:

- **azure-speech** -> eksisterende 10-min token (flytt logikk, behold oppførsel).
- **azure-openai** -> utsted ephemeral Realtime session-key (server kaller Azure OpenAI
  `/realtime/sessions` med api-key); browser åpner Realtime WebSocket med `intent=transcription`.
- **aws** -> server returnerer kortlevde STS-credentials (eller en SigV4-presignert WebSocket-URL);
  browser åpner Transcribe streaming-tilkoblingen.

### LiveTranscriber-interface

```ts
interface LiveTranscriber {
  start(): Promise<void>;
  stop(): Promise<{ transcript: string }>;
  onPartial?: (text: string) => void;   // interim -> live UI
  onFinal?: (text: string) => void;     // committed segment
  onError?: (err: Error) => void;
}
```

`record/page.tsx` brancher aldri på provider:

```ts
const live = createLiveTranscriber(providerId);   // factory fra registry
live.onPartial = ...; live.onFinal = ...; live.onError = ...;
await live.start(); /* ... */ await live.stop();
```

### Kjente realiteter (flagget, ikke begravd)

- **AWS browser SDK + credentials:** å eksponere kortlevde STS-creds til browser er standard
  AWS streaming-mønster, men den fiklete-ste auth-en av de tre. Hvis presigning blir stygt på
  Vercel er fallback en tynn server-relay **kun for AWS live** — brukes bare om browser-direkte
  slåss imot oss.
- **Live partial-results-paritet:** Azure gir fine interim `recognizing`-events. Realtime og AWS
  streaming sender også partials, men formen er ulik. Normaliser til "interim-linje +
  committed-linjer" så det føles konsistent på tvers.

## UI

`<ModelSelect>` — ny primitiv i `components/ui/` (cva + `cn()`-mønster, norske labels):

- Props: `mode: "batch" | "live"`, leser `registry.byMode(mode)`.
- Rendres på `/record` ved siden av eksisterende batch/live-toggle. Toggle bytter -> dropdown
  re-populeres med den modusens leverandører.
- Endring -> persist til `localStorage` (`transcribeProvider:batch` / `:live`). Ved load:
  default = lagret verdi, ellers registerets første entry.
- FAB og PiP rendrer ikke dropdownen; de leser samme `localStorage`-default så "sist valgte"
  følger med. Delt `getDefaultProvider(mode)`-helper så alle tre flatene er enige.

## Persistens / DB

- `prisma db push` legger til `transcribeProvider String?` på `Call` (nullable -> eksisterende
  rader OK; ikke `migrate dev`, jf. CLAUDE.md).
- POST `/api/calls` skriver feltet; `RECORDED`-raden får det fra start.
- Detaljsiden `/calls/[id]` viser en liten badge ("gpt-4o-transcribe", "Azure Speech", …) ved
  siden av eksisterende mode-badge — ny entry i `components/call-badges`.

## Feilhåndtering

- **Batch:** dispatcheren wrapper hver provider; feil setter `status: "FAILED"` + `error`
  (eksisterende mønster), og meldingen navngir provideren ("Azure OpenAI: 429 …").
- **Live:** `onError` viser norsk toast/inline-melding og stopper rent. Token-endepunkt-feil
  returnerer tydelig 4xx som klienten viser **før** opptak starter — feil før du snakker, ikke etter.
- **Ukonfigurert provider** (manglende nøkkel): registeret kan markere `available: false` fra en
  server-sjekk, så dropdownen disabler valget med et hint i stedet for å la deg velge et dødt
  alternativ.

## Testing

- Batch-providere bruker harnesset som fasit; manuell `/record`-kjøring per provider i browser
  (curl krever auth-cookie, jf. CLAUDE.md).
- `npx tsc --noEmit` + `npm run lint` grønne per fase.
- Live: manuell browser-test per provider — eneste reelle måte (mikrofon + streaming). Verifiser
  at partials vises, final transcript når Claude, badge persisterer.

## Env-vars

Lokalt `.env.local` nå; **Vercel Production+Preview** før deploy:

- Allerede til stede: `AZURE_SPEECH_KEY/REGION`, `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION`,
  `AZURE_OPENAI_ENDPOINT/KEY/TRANSCRIBE_DEPLOYMENT`.
- Azure OpenAI Realtime trenger muligens en **realtime-capable deployment** (transcribe-deployment
  kan holde; bekreftes ved bygging) — eventuelt `AZURE_OPENAI_REALTIME_DEPLOYMENT`.
- AWS live trenger at eksisterende IAM-creds tillater `transcribe:StartStreamTranscriptionWebSocket`
  (+ `sts:GetFederationToken`/session-token om vi presigner).

## Faser (hver uavhengig testbar / shippbar)

1. **Batch dispatcher** — 3 batch-providere + `<ModelSelect>` (batch) + `transcribeProvider`-kolonne
   + detalj-badge. Shipper alene.
2. **Live refactor** — trekk ut Azure Speech bak `LiveTranscriber`-interfacet, wire `<ModelSelect>`
   (live). Ren refactor, ingen ny provider — beviser abstraksjonen med null oppførselsendring.
3. **Azure OpenAI Realtime** live.
4. **AWS Transcribe Streaming** live.

## Ikke i scope

- Deepgram og Google i dropdownene (bevisst utelatt — batch-lista er Azure/Azure-OpenAI/AWS).
- Server-proxied live (WebSocket gjennom vår backend) — vurdert og forkastet (Vercel-friksjon;
  hører til rebuilden).
- Ekte AWS S3 batch-jobb — erstattet av streaming-collect.
- Full live partial-paritet på ord-nivå — normaliseres til interim+committed i stedet.
