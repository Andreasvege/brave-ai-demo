@AGENTS.md

# Brave CallAI

Transkribering og AI-analyse av cold calls. Dette er ikke lenger en demo — det er
grunnlaget for et reelt produkt. Første målgruppe er selgerne i Brave, men arkitektur
og beslutninger skal tas med tanke på at produktet skal kunne selges eksternt.
Større API- og skjemaendringer er ønskelige når de gir bedre fundament.

Spesifikasjonen er DEMO-SCOPE-seksjonen øverst i `brave-callai-mvp-guide.md`
(den overstyrer resten av dokumentet) — men produktambisjonen overstyrer demo-begrensninger
der de er i konflikt.

## Stack
- Next.js 16 (App Router, Turbopack) — les `node_modules/next/dist/docs/` ved tvil, se AGENTS.md
- Prisma 6 + **Neon PostgreSQL** — **ikke** oppgrader til Prisma 7 (krever adapter-oppsett,
  `url` i schema er fjernet). `Call.status` og `Call.analysis` er strenger
  (analyse = JSON-streng, parses med `JSON.parse`). Schema bruker `POSTGRES_PRISMA_URL`
  (pooled) og `DATABASE_URL_UNPOOLED` (directUrl for migrering).
  Build-scriptet kjører `prisma generate && next build` for Vercel-kompatibilitet.
- Azure Speech, westeurope, nb-NO — to veier fra mikrofon:
  - **Live**: `microsoft-cognitiveservices-speech-sdk` i nettleseren (lastes dynamisk i
    `/record`), token fra `POST /api/speech-token` (10 min levetid, nøkkel forblir på server)
  - **Batch-opptak**: MediaRecorder lagrer lyd lokalt, sender webm til Azure batch etter stopp
  - **Filopplasting**: fast transcription, api-version **2025-10-15** (`lib/transcribe.ts`)
  - Brukeren velger mellom live og batch via toggle på `/record`
- Claude `claude-sonnet-4-5` for analyse (`lib/analyze.ts`) — prompten får transkript,
  konsulentens notater og valgfri tilleggsinformasjon som tre adskilte seksjoner.
  `analyzeTranscript(transcript, notes, extraContext?)` — extraContext brukes ved re-analyse.
- Nøkler i `.env.local`: AZURE_SPEECH_KEY/REGION, ANTHROPIC_API_KEY, AUTH_SECRET,
  GOOGLE_CLIENT_ID/SECRET, POSTGRES_PRISMA_URL, DATABASE_URL_UNPOOLED

## Arkitektur
- `POST /api/calls` kjører pipelinen **synkront** og tar multipart med ENTEN `transcript`
  (tekst fra live-transkribering → rett til analyse) ELLER `audio` (fil → Azure batch →
  analyse), pluss notes/durationSec. Returnerer analyse-JSON. Status skrives til DB underveis
  (TRANSCRIBING → ANALYZING → DONE/FAILED); `/record` poller liste-endepunktet for
  statusvisning på batch-veien
- `GET/PATCH/DELETE /api/calls/[id]` — detalj, titteledit (`title`-felt i DB) og hard delete
- `POST /api/calls/[id]/reanalyze` — kjører Claude-analyse på nytt med eksisterende transkripsjon.
  Tar valgfri `{ extraContext }` i body. Nyttig for prompt-tuning uten nytt opptak.
- Sider: `/` (liste), `/record` (opptak med live/batch-toggle, avbryt-knapp, kun mikrofon,
  aldri systemlyd — GDPR), `/calls/[id]` (analyse-kort, CRM-kopi, Google Calendar-lenke,
  klikk-og-rediger tittel, re-analyser med tilleggsinformasjon)
- Lydfiler lagres aldri — transkriberes direkte fra upload

## Konvensjoner
- Alt UI på norsk; lys Linear-estetikk, designtokens i `app/globals.css`, aksent #3a5c28
- Gjenbrukbare UI-komponenter (shadcn-mønster med cva + `cn()` fra `lib/utils.ts`):
  primitives i `components/ui/` (Button/buttonVariants, Badge, Card/CardAccentHeader/
  CardContent/Kicker, Spinner), domenekomponenter i `components/` (call-badges, icons).
  Ny UI skal bygges av disse — ikke inline Tailwind-knapper/kort i sidene.
  Lenker stylet som knapper bruker `buttonVariants()` på `<Link>`/`<a>`
- CRM/kalender-API er ikke koblet til ennå, men arkitekturen skal gjøre det mulig
- **Auth**: NextAuth.js v5 med Google OAuth. Kun `@brave.no`-adresser slipper inn
  (callback i `auth.ts`). Middleware beskytter alle ruter inkl. API-et.
- **Delt tilgang**: Alle innloggede brukere ser og redigerer alle samtaler — ingen
  per-bruker-eierskap. Dette er bevisst design (teamverktøy for Brave). Når produktet
  selges eksternt må `userId`/`teamId` legges på `Call`-modellen og tilgangsstyring
  implementeres. IDOR-flagging er ikke relevant innenfor ett team.

## Planlagte DB-endringer (ikke gjort ennå)
Neste større migrering skal inkludere:
- `analysis String?` → `analysis Json?` (JSONB i Postgres via Neon) — slipper `JSON.parse`/`JSON.stringify`, muliggjør DB-spørringer inn i JSON
- `outcome String?` som egen kolonne (utledet fra analyse) — for filtrering i liste
- `transcriptionScore Int?` som egen kolonne — for kvalitetssporing over tid
- `userId String?` — hvem som opprettet samtalen (eierskap, filtrering)
- `audioUrl String?` — URL til lydfil i Vercel Blob (midlertidig lagring for transkripsjonskvalitetssjekk)
- Eventuelt flere felt etter videre avklaring — ikke migrer før alle ønskede endringer er klare

## Prompt-tuning
Analysen styres av to konstanter i `lib/analyze.ts`:
- `SYSTEM_PROMPT` — personlighet, kontekst og regler for Claude
- `ANALYSIS_SCHEMA` — JSON-strukturen Claude skal returnere (tekst, ikke ekte JSON-schema)
Bruk «↻ Kjør analyse på nytt» på detaljsiden for å teste endringer uten nytt opptak.
Legg til nye felt: beskriv dem i `ANALYSIS_SCHEMA` + legg til i `export type Analysis`.
Prisma-skjemaet trenger ikke endres — hele analysen er én JSON-streng i `Call.analysis`.

## Test
Dev-server + ende-til-ende:
```
npm run dev
curl -X POST http://localhost:3000/api/calls -F "audio=@lydopptak/testopptak1.m4a" -F "notes=..."
```
Responsen skal ha status DONE og `analysis` med summary, outcome, sales_tips,
suggested_crm_update og suggested_meeting. `npx tsc --noEmit` og `npm run lint` skal være grønne.
