# DEMO-SCOPE (overstyrer resten av dokumentet ved konflikt)

## Tekniske rammer
- Azure Speech: region **westeurope**, fast transcription, **api-version 2025-10-15**, locale nb-NO
- Database: **SQLite** via Prisma (ikke Postgres)
- **Ingen auth**, ingen ekte CRM/kalender-integrasjon
- Claude API: claude-sonnet-4-5, analyse-prompten lenger ned i dokumentet

## Sider og funksjonalitet
1. **/record** — opptaksside:
   - Stor start/stopp-knapp med timer (MediaRecorder, KUN mikrofon, webm/opus)
   - Filopplasting som alternativ (m4a/webm/wav/mp3)
   - **Notatfelt (textarea) synlig under opptak** — konsulenten skriver live-notater
     mens samtalen pågår. Lagres som `notes` på Call.
2. **Pipeline-status** — vis tydelig fremdrift: "Transkriberer…" → "Analyserer…" → ferdig
3. **/ (liste)** — alle samtaler: dato, varighet, outcome-badge, klikk til detalj
4. **/calls/[id]** — detaljside:
   - Transkript (sammenleggbar)
   - Oppsummering + neste steg
   - Salgstips med sitater fra samtalen
   - CRM-kort: ferdig notat + felter, "Kopier notat"-knapp (clipboard, ingen API)
   - Møtekort: generer ferdig utfylt Google Calendar-lenke
     (https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&details=...&dates=...)
   - Slett-knapp (hard delete)

## Analyse-input
Claude-prompten skal motta BÅDE transkriptet OG konsulentens notater, som to
adskilte seksjoner. Notatene beskriver ofte hva motparten sa (transkriptet er
én-sidet), så de er kritisk kontekst — instruér modellen om dette eksplisitt.

## Visuelt
- Lys, clean, Linear/Notion-estetikk: hvit/varm-grå bakgrunn, ett aksentfarge,
  god whitespace, ingen default-Tailwind-følelse
- Analyse-kortene på detaljsiden er de visuelle heltene
- Alt UI på **norsk**

## Bevisst UTE av demo
Auth, ekte HubSpot/kalender-API, redigering av analyser, aggregert statistikk,
sanntidstranskribering, multi-bruker

Resten av GUIDEN:

# Brave CallAI — MVP-guide

En-sidet transkribering av cold calls med AI-analyse: oppsummering, salgstips, møtebooking og CRM-utkast. Internt verktøy først, salgbart produkt senere.


---

## 1. MVP-scope (hva vi bygger, og hva vi IKKE bygger)

**Inn i MVP:**
- Opptak av kun konsulentens mikrofon (aldri systemlyd/motpart)
- Batch-transkribering etter samtalen (ikke sanntid)
- AI-analyse per samtale: oppsummering, neste steg, innvendinger, salgstips
- Forslag til CRM-oppdatering og møteinvitasjon som konsulenten godkjenner med ett klikk
- Enkel dashboard: liste over samtaler, detaljvisning, slett-knapp

**Ute av MVP (v2+):**
- Sanntidstranskribering og live-tips
- Aggregert analyse på tvers av samtaler ("trender for hele teamet")
- Automatisk CRM-skriving uten godkjenning
- Multi-tenant / kundeportal for videresalg
- Mobilapp

Begrunnelse: batch-pipeline er 10 % av kompleksiteten til sanntid og gir 90 % av verdien i v1. Human-in-the-loop på CRM/kalender gjør at feil i AI-en aldri når kunden.

---

## 2. Arkitektur

```
[Browser/Desktop]                    [Vercel / Next.js app]              [Eksterne tjenester]

 Mic-opptak (MediaRecorder)
        │  webm/opus
        ▼
 POST /api/calls  ──────────────►  Lagre lydfil (Vercel Blob / S3 EU)
                                          │
                                          ▼
                                   Transkribering (Azure Speech EU
                                   eller selvhostet Whisper)
                                          │  tekst
                                          ▼
                                   Claude API: analyse-pipeline
                                   → strukturert JSON
                                          │
                                          ▼
                                   Postgres (Prisma): Call, Transcript,
                                   Analysis, SuggestedActions
                                          │
                                          ▼
 Dashboard (Next.js app router) ◄──  Konsulent ser resultat,
                                     godkjenner/avviser actions
                                          │ godkjent
                                          ▼
                                   CRM API (HubSpot/Pipedrive)
                                   Kalender API (Google/Outlook)
```

Tre uavhengige steg (opptak → transkribering → analyse) med status i databasen. Hvert steg kan feile og kjøres på nytt uten å miste data.

---

## 3. Lydopptak (kun egen side)

Den enkleste og GDPR-tryggeste tilnærmingen: ta opp **kun mikrofonen** i nettleseren. Motpartens lyd går i headset og fanges aldri.

```typescript
// hooks/useMicRecorder.ts
import { useRef, useState } from "react";

export function useMicRecorder() {
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        // VIKTIG: aldri getDisplayMedia / systemlyd
      },
    });
    chunks.current = [];
    mediaRecorder.current = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 32_000, // tale trenger ikke mer, sparer lagring
    });
    mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
    mediaRecorder.current.start(1000); // chunk hvert sekund
    setIsRecording(true);
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve) => {
      mediaRecorder.current!.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        mediaRecorder.current!.stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        resolve(blob);
      };
      mediaRecorder.current!.stop();
    });
  }

  return { start, stop, isRecording };
}
```

**Praktisk tips:** Konsulentene ringer sannsynligvis via Teams/telefon/softphone. En nettleserfane med "Start opptak"-knapp ved siden av funker fint i MVP. Desktop-app (Tauri/Electron) med global hurtigtast er en v2-forbedring.

---

## 4. Transkribering

Tre realistiske alternativer, rangert for dere:

| Alternativ | Norsk kvalitet | GDPR | Kostnad | Innsats |
|---|---|---|---|---|
| **Azure Speech (EU-region)** | Veldig god | DPA, EU-data, enkel | ~1 kr/min batch | Lav |
| **OpenAI Whisper API** | Veldig god | DPA finnes, men US-selskap | ~0,06 kr/min | Lavest |
| **Selvhostet whisper.cpp / faster-whisper** | God (large-v3) | Full kontroll | Server-kostnad | Høyest |

**Anbefaling for MVP:** Start med Azure Speech i `norwayeast` eller `westeurope`. Norsk støtte er solid, dere får databehandleravtale og EU-prosessering rett ut av boksen, og det er et godt svar når kunder spør om GDPR. Bytt til selvhostet senere hvis volumet gjør det lønnsomt.

```typescript
// lib/transcribe.ts — Azure Speech batch (fast transcription API)
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append("audio", new Blob([audioBuffer]), "call.webm");
  formData.append(
    "definition",
    JSON.stringify({ locales: ["nb-NO"] })
  );

  const res = await fetch(
    `https://${process.env.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY! },
      body: formData,
    }
  );
  if (!res.ok) throw new Error(`Azure Speech: ${res.status}`);
  const data = await res.json();
  return data.combinedPhrases.map((p: any) => p.text).join(" ");
}
```

---

## 5. AI-analyse med Claude

Kjernen i produktet. Én API-kall per samtale med strukturert JSON-output. Nøkkelen for én-sidet transkripsjon er å be modellen eksplisitt om å **resonnere rundt hva motparten sannsynligvis sa**, basert på konsulentens replikker.

```typescript
// lib/analyze.ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `Du er en erfaren norsk salgscoach som analyserer cold calls.

VIKTIG KONTEKST: Du får KUN selgerens side av samtalen (motparten er ikke
tatt opp). Bruk selgerens spørsmål, svar og reaksjoner til å utlede hva
motparten sannsynligvis sa. Marker tydelig hva som er utledet vs. eksplisitt.

Svar KUN med gyldig JSON, ingen markdown, ingen forklaring.`;

const ANALYSIS_SCHEMA = `{
  "summary": "2-4 setninger om hva samtalen handlet om og utfallet",
  "outcome": "booked_meeting" | "callback" | "not_interested" | "no_answer" | "unclear",
  "inferred_prospect_context": "Hva vi kan utlede om motpartens situasjon og behov",
  "objections": [{ "objection": "innvending som ble håndtert", "handled_well": boolean, "inferred": boolean }],
  "next_steps": ["konkrete neste steg"],
  "sales_tips": [{ "tip": "konkret, handlingsrettet tips", "example_from_call": "sitat fra selgeren" }],
  "suggested_crm_update": {
    "company": string | null,
    "contact_name": string | null,
    "status": string,
    "notes": "forslag til CRM-notat"
  },
  "suggested_meeting": {
    "should_book": boolean,
    "proposed_title": string | null,
    "proposed_duration_minutes": number | null,
    "notes": string | null
  }
}`;

export async function analyzeTranscript(transcript: string) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyser denne transkripsjonen (kun selgerens side) og svar med JSON etter dette skjemaet:\n\n${ANALYSIS_SCHEMA}\n\nTRANSKRIPSJON:\n${transcript}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
```

**Prompt-tips fra erfaring:**
- `inferred: true/false`-flagget på innvendinger er gull — konsulenten ser hva AI-en gjetter vs. vet
- Be om sitater fra samtalen i salgstipsene, ellers blir tipsene generiske ("vær mer engasjert" er ubrukelig, "du sa 'eh, jeg vet ikke helt' da kunden spurte om pris" er nyttig)
- Temperatur lav / default, dette er ekstraksjon, ikke kreativ skriving

---

## 6. Datamodell (Prisma)

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  calls     Call[]
  createdAt DateTime @default(now())
}

model Call {
  id           String     @id @default(cuid())
  user         User       @relation(fields: [userId], references: [id])
  userId       String
  audioUrl     String?    // Blob/S3-URL, slettes etter transkribering (anbefalt)
  status       CallStatus @default(RECORDED)
  durationSec  Int?
  transcript   String?    @db.Text
  analysis     Json?      // hele analyse-JSON-en
  actions      SuggestedAction[]
  createdAt    DateTime   @default(now())
  deleteAfter  DateTime   // createdAt + 90 dager, cron sletter
}

enum CallStatus {
  RECORDED
  TRANSCRIBING
  ANALYZING
  DONE
  FAILED
}

model SuggestedAction {
  id        String       @id @default(cuid())
  call      Call         @relation(fields: [callId], references: [id], onDelete: Cascade)
  callId    String
  type      ActionType
  payload   Json
  status    ActionStatus @default(PENDING)
  createdAt DateTime     @default(now())
}

enum ActionType {
  CRM_UPDATE
  BOOK_MEETING
}

enum ActionStatus {
  PENDING
  APPROVED
  REJECTED
  EXECUTED
  FAILED
}
```

Merk `deleteAfter`-feltet: bygg sletting inn fra dag én (Vercel Cron som kjører daglig). Det er mye lettere enn å ettermontere, og det er deres beste GDPR-argument.

---

## 7. Pipeline (API-ruter)

```
POST /api/calls            → last opp lydblob, lag Call(RECORDED), trigg pipeline
POST /api/calls/[id]/run   → transkriber → analyser → lag SuggestedActions → DONE
GET  /api/calls            → liste for innlogget bruker (KUN egne samtaler)
GET  /api/calls/[id]       → detalj med analyse og actions
POST /api/actions/[id]/approve → utfør mot CRM/kalender
DELETE /api/calls/[id]     → hard delete (konsulentens rett til sletting)
```

Pipeline-steget kan ta 30-60 sek for en lang samtale. På Vercel: bruk en route med `maxDuration: 300` (Pro-plan) eller flytt tunge steg til en enkel jobb-kø (Inngest og Trigger.dev er begge gratis å starte med og passer Next.js perfekt). For MVP holder det ofte med en lang serverless-funksjon.

---

## 8. Actions: CRM og møtebooking

**Prinsipp: AI foreslår, mennesket godkjenner.** Dashboard viser forslaget som et kort med "Godkjenn" / "Avvis".

**CRM:** Hvilket CRM bruker dere i dag? For MVP, integrer mot ett:
- **HubSpot**: gratis tier, veldig godt API, `@hubspot/api-client` på npm. Opprett/oppdater contact + company + note + deal stage.
- **Pipedrive**: enklere API, populært i norske SMB-er.

```typescript
// Godkjent CRM_UPDATE → HubSpot
import { Client } from "@hubspot/api-client";
const hubspot = new Client({ accessToken: process.env.HUBSPOT_TOKEN });

export async function executeCrmUpdate(payload: CrmPayload) {
  // 1. Søk etter eksisterende kontakt, 2. opprett/oppdater, 3. legg til notat
  // Hold det idempotent: bruk e-post/orgnr som nøkkel hvis tilgjengelig
}
```

**Møtebooking:** Ikke book direkte i MVP. Generer i stedet en ferdig utfylt lenke eller utkast:
- Enkleste: generer en Google Calendar "event template URL" konsulenten klikker på
- Bedre: Google Calendar API med OAuth per bruker, opprett event med status "tentative"

---

## 9. Dashboard (Next.js app router)

Sider i MVP:

```
/                  → samtaleliste (dato, varighet, outcome-badge, status)
/calls/[id]        → transkript + analyse + action-kort + slett-knapp
/record            → opptaksside med stor start/stopp-knapp og timer
/settings          → CRM-tilkobling, info om datalagring og sletting
```

Gjenbruk komponentarkitekturen fra Vekstprofil (primitives/brand/form-strukturen med cva passer rett inn her). Outcome-badges, status-pills og action-kort er klassiske `cva`-varianter.

---

## 10. GDPR-minimum for MVP (selv om "alt fikses senere")

Dette er det absolutte minimumet som bør være på plass **før første ekte samtale tas opp**, ikke senere:

1. **Kun mic-opptak, aldri motpart** — håndhevet i kode, ikke bare policy
2. **Konsulenten eier sin data**: ser alt, kan slette alt, ingen leder-innsyn i MVP
3. **Automatisk sletting**: lydfil slettes etter transkribering, transkript etter 90 dager
4. **Intern info-skriv** til de som tester: hva lagres, hvor, hvor lenge, hvorfor
5. **EU-prosessering**: Azure EU-region, database i EU (Vercel Postgres i fra/Frankfurt, Neon EU, eller Supabase EU)

Interesseavveining og DPIA skrives før utrulling utover pilotgruppa. (Tilbudet om utkast står fortsatt 😄)

---

## 11. Faseplan

**Fase 1 — uke 1-2: Kjerne-pipeline**
- Next.js-prosjekt, Prisma-skjema, auth (NextAuth/Clerk)
- Opptaksside med MediaRecorder
- Azure Speech-integrasjon + Claude-analyse
- Detaljside som viser resultatet

**Fase 2 — uke 3: Actions + polish**
- SuggestedActions med godkjenningsflyt
- HubSpot/Pipedrive-integrasjon (én av dem)
- Sletting + cron for retention
- Pilot med 2-3 konsulenter i Brave

**Fase 3 — uke 4+: Iterasjon på ekte data**
- Juster analyse-prompten basert på ekte samtaler (dette er der 80 % av kvaliteten kommer fra)
- Møtebooking-integrasjon
- Mål: "tid spart per samtale" og "andel godkjente CRM-forslag" som suksessmetrikker

**Senere (produktisering):**
- Multi-tenant, org-struktur, fakturering
- Sanntid (WebSocket + streaming STT + streaming Claude)
- Aggregert teaminnsikt (krever ny GDPR-vurdering!)
- DPIA + interesseavveining som salgbar "GDPR-pakke"

---

## 12. Kostnadsestimat (drift, MVP-skala)

Antatt 5 konsulenter × 20 samtaler/dag × 3 min snitt = ~300 min/dag:

| Post | Estimat/mnd |
|---|---|
| Azure Speech batch (~6 600 min) | ~600-700 kr |
| Claude API (Sonnet, ~6 600 analyser à ~2k tokens) | ~400-600 kr |
| Vercel Pro + Postgres | ~250-450 kr |
| Blob-lagring (lyd slettes raskt) | < 50 kr |
| **Totalt** | **~1 300-1 800 kr/mnd** |

Billig nok til at business caset nesten skriver seg selv hvis det sparer hver konsulent 10 min/dag.

---

## Neste steg

1. Avklar hvilket CRM Brave bruker i dag (styrer fase 2)
2. Sett opp Azure Speech-ressurs i EU-region og test norsk transkribering med en testopptak av deg selv
3. Scaffold prosjektet og bygg fase 1
4. Test analyse-prompten manuelt med 3-4 ekte (egne) samtaler før dere automatiserer
