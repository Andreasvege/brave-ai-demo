@AGENTS.md

# Brave CallAI — demo

Transkribering og AI-analyse av cold calls. Spesifikasjonen er DEMO-SCOPE-seksjonen
øverst i `brave-callai-mvp-guide.md` (den overstyrer resten av dokumentet).

## Stack
- Next.js 16 (App Router, Turbopack) — les `node_modules/next/dist/docs/` ved tvil, se AGENTS.md
- Prisma 6 + SQLite (`prisma/dev.db`) — **ikke** oppgrader til Prisma 7 (krever adapter-oppsett,
  `url` i schema er fjernet). SQLite-connectoren støtter ikke enum/Json, derfor er
  `Call.status` og `Call.analysis` strenger (analyse = JSON-streng, parses med `JSON.parse`)
- Azure Speech, westeurope, nb-NO — to veier:
  - **Live**: `microsoft-cognitiveservices-speech-sdk` i nettleseren (lastes dynamisk i
    `/record`), token fra `POST /api/speech-token` (10 min levetid, nøkkel forblir på server)
  - **Batch** (filopplasting/curl): fast transcription, api-version **2025-10-15** (`lib/transcribe.ts`)
- Claude `claude-sonnet-4-5` for analyse (`lib/analyze.ts`) — prompten får transkript OG
  konsulentens notater som to adskilte seksjoner (transkriptet er én-sidet, notatene
  beskriver motparten)
- Nøkler i `.env.local`: AZURE_SPEECH_KEY/REGION, ANTHROPIC_API_KEY

## Arkitektur
- `POST /api/calls` kjører pipelinen **synkront** og tar multipart med ENTEN `transcript`
  (tekst fra live-transkribering → rett til analyse) ELLER `audio` (fil → Azure batch →
  analyse), pluss notes/durationSec. Returnerer analyse-JSON. Status skrives til DB underveis
  (TRANSCRIBING → ANALYZING → DONE/FAILED); `/record` poller liste-endepunktet for
  statusvisning på batch-veien
- `GET/DELETE /api/calls/[id]` — detalj og hard delete
- Sider: `/` (liste), `/record` (live-transkribering med interim-visning, kun mikrofon,
  aldri systemlyd — GDPR), `/calls/[id]` (analyse-kort, CRM-kopi, Google Calendar-lenke)
- Lydfiler lagres aldri — transkriberes direkte fra upload

## Konvensjoner
- Alt UI på norsk; lys Linear-estetikk, designtokens i `app/globals.css`, aksent #22cde1
- Gjenbrukbare UI-komponenter (shadcn-mønster med cva + `cn()` fra `lib/utils.ts`):
  primitives i `components/ui/` (Button/buttonVariants, Badge, Card/CardAccentHeader/
  CardContent/Kicker, Spinner), domenekomponenter i `components/` (call-badges, icons).
  Ny UI skal bygges av disse — ikke inline Tailwind-knapper/kort i sidene.
  Lenker stylet som knapper bruker `buttonVariants()` på `<Link>`/`<a>`
- Bevisst UTE av demoen: auth, ekte CRM/kalender-API, multi-bruker

## Test
Dev-server + ende-til-ende:
```
npm run dev
curl -X POST http://localhost:3000/api/calls -F "audio=@lydopptak/testopptak1.m4a" -F "notes=..."
```
Responsen skal ha status DONE og `analysis` med summary, outcome, sales_tips,
suggested_crm_update og suggested_meeting. `npx tsc --noEmit` og `npm run lint` skal være grønne.
