@AGENTS.md

# Brave CallAI

Transkribering og AI-analyse av cold calls. Dette er et reelt produkt — ikke en demo.
Første målgruppe er selgerne i Brave, men arkitektur og beslutninger skal tas med tanke
på at produktet kan selges eksternt. Større API- og skjemaendringer er velkomne når de
gir bedre fundament.

## Stack
- Next.js 16 (App Router, Turbopack) — les `node_modules/next/dist/docs/` ved tvil, se AGENTS.md
- Prisma 6 + **Neon PostgreSQL** — **ikke** oppgrader til Prisma 7. Schema bruker
  `POSTGRES_PRISMA_URL` (pooled) og `DATABASE_URL_UNPOOLED` (directUrl for migrering).
  Build-scriptet kjører `prisma generate && next build` for Vercel-kompatibilitet.
  **Bruk `prisma db push` for skjemaendringer** — `prisma migrate dev` feiler pga. drift
  i migrasjonshistorikken.
- Azure Speech, westeurope, nb-NO — to veier fra mikrofon:
  - **Batch-opptak** (standard, venstre fane): MediaRecorder → webm → Azure fast transcription
  - **Live**: Azure Speech SDK i nettleseren, token fra `POST /api/speech-token`
  - **Filopplasting**: samme som batch, api-version **2025-10-15** (`lib/transcribe.ts`)
- Claude `claude-sonnet-4-5` for analyse (`lib/analyze.ts`) — returnerer `Analysis`-objekt.
  `analyzeTranscript(transcript, notes, extraContext?)` — extraContext brukes ved re-analyse.
- **Vercel Blob** (`@vercel/blob`) — private lydfillagring. **VIKTIG: send alltid tokenet
  eksplisitt** — SDK plukker ikke opp `BLOB_READ_WRITE_TOKEN` automatisk fra miljøet:
  `put(path, file, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN })`
- Nøkler i `.env.local`: AZURE_SPEECH_KEY/REGION, ANTHROPIC_API_KEY, AUTH_SECRET,
  GOOGLE_CLIENT_ID/SECRET, POSTGRES_PRISMA_URL, DATABASE_URL_UNPOOLED, BLOB_READ_WRITE_TOKEN

## Databaseskjema (Call)
`analysis` er **JSONB** (`Json?` i Prisma) — ikke lenger en streng. Ikke bruk
`JSON.parse`/`JSON.stringify`. Cast med `call.analysis as Analysis | null` i TypeScript.

Nåværende felt: `id`, `title`, `status`, `transcribeMode`, `outcome`, `userId`, `teamId`,
`audioUrl`, `durationSec`, `notes`, `transcript`, `analysis`, `error`, `createdAt`

Status-verdier: `RECORDED → TRANSCRIBING → ANALYZING → DONE / FAILED`

## Arkitektur
- `POST /api/calls` — synkron pipeline. Tar multipart med `transcript` (live) eller
  `audio` (batch/fil) + `notes`, `durationSec`, `transcribeMode`. Ved lydfil: laster
  opp til Vercel Blob (privat) → Azure fast transcription → Claude-analyse → lagrer alt.
- `GET /api/calls/[id]/audio` — proxy-rute som serverer privat blob bak auth.
  Bruk `get(url, { access: "private", token: ... })` fra `@vercel/blob`.
- `GET/PATCH/DELETE /api/calls/[id]` — detalj, titteledit, hard delete (sletter også blob).
- `POST /api/calls/[id]/reanalyze` — kjører Claude på nytt. `maxDuration = 300`.
  Setter `status: "FAILED"` ved feil (ikke "DONE").
- Sider: `/` (liste med bulk-slett via `app/call-list.tsx` — client component),
  `/record` (batch default, live toggle, filopplasting), `/calls/[id]` (analyse,
  lydavspiller, CRM-kopi, kalender, re-analyser)
- Lydfiler: lagres i Vercel Blob med privat tilgang. Slettes når samtalen slettes.
  Vises kun i detaljsiden med `<audio>`-spiller + nedlastingslenke.

## Konvensjoner
- Alt UI på norsk; lys Linear-estetikk, designtokens i `app/globals.css`, aksent #3a5c28
- Gjenbrukbare UI-komponenter (shadcn-mønster med cva + `cn()` fra `lib/utils.ts`):
  primitives i `components/ui/` (Button/buttonVariants, Badge, Card/CardAccentHeader/
  CardContent/Kicker, Spinner), domenekomponenter i `components/` (call-badges, icons).
  Ny UI skal bygges av disse — ikke inline Tailwind-knapper/kort i sidene.
- **`position: fixed` global UI** (FAB, overlays) MÅ ligge i `layout.tsx`, ikke inne i `.fade-up`-div —
  `transform`-animasjonen oppretter nytt stacking context og bryter `fixed`-posisjonering
- Tidssone: hardkodet `Europe/Oslo` i `lib/format.ts` (`formatDate`)
- CRM/kalender-API er ikke koblet til ennå, men arkitekturen skal gjøre det mulig
- **Auth**: NextAuth.js v5 med Google OAuth. Kun `@brave.no`-adresser slipper inn.
  Middleware beskytter alle ruter inkl. API-et.
- **Delt tilgang**: Alle innloggede brukere ser og redigerer alle samtaler — bevisst
  design (teamverktøy). `userId`/`teamId` er i DB men ikke koblet til tilgangsstyring ennå.
  Kobles inn når produktet selges eksternt. IDOR-flagging er ikke relevant innenfor ett team.

## PWA
- Manifest: `app/manifest.ts`, service worker: `public/sw.js`, ikoner: `public/icons/`
- `beforeinstallprompt` fanges tidlig via inline script i `layout.tsx <head>` → `window.__pwaInstallEvent`
  (React hydrerer for sent til å fange hendelsen via useEffect alene)
- **Middleware-matcher MÅ ekskludere PWA-ressurser** — ellers redirectes de til `/login`:
  `manifest.webmanifest|sw.js|icons/` må inn i `config.matcher`-negasjonen i `middleware.ts`
- Flytende opptakswidget: `components/pip-record-content.tsx` via Document Picture-in-Picture API
  (Chrome 116+). Rendres med `ReactDOM.createRoot` inn i PiP-vinduets document. Fallback: modal-overlay.

## Fremtidige DB-endringer
- `outcome` som egen kolonne er i skjemaet men populeres ikke ennå (ligger i `analysis` JSONB)
- `userId`/`teamId` for multi-tenant tilgangsstyring — kobles inn ved eksternt salg
- `analysis Json?` → vurder å trekke ut flere felt som egne kolonner for filtrering/statistikk

## Prompt-tuning
Analysen styres av to konstanter i `lib/analyze.ts`:
- `SYSTEM_PROMPT` — personlighet, kontekst og regler for Claude
- `ANALYSIS_SCHEMA` — JSON-strukturen Claude skal returnere
Bruk «↻ Kjør analyse på nytt» på detaljsiden for å teste endringer uten nytt opptak.
Legg til nye felt: beskriv i `ANALYSIS_SCHEMA` + legg til i `export type Analysis`.
Prisma-skjemaet trenger ikke endres — hele analysen er JSONB i `Call.analysis`.

## Test
```
npm run dev
curl -X POST http://localhost:3000/api/calls -F "audio=@lydopptak/testopptak1.m4a" -F "notes=..."
```
Responsen skal ha status DONE og `analysis` med summary, outcome, sales_tips,
suggested_crm_update og suggested_meeting. `npx tsc --noEmit` og `npm run lint` skal være grønne.
