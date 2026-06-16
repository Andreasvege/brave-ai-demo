# Design: PWA + Mini-opptaksmodal

**Dato:** 2026-06-16
**Status:** Godkjent

## Mål

Gjøre Brave CallAI installerbar som PWA (eget vindu) og legge til en flytende
mini-opptaksknapp på listen slik at selgeren kan starte opptak uten å navigere bort
fra det han holder på med.

---

## Del 1: PWA-oppsett

### Hva

Next.js App Router sin innebygde metadata-API brukes — ingen ekstra pakker.

### Filer

- **`app/manifest.ts`** — eksporterer et `MetadataRoute.Manifest`-objekt med:
  - `name: "Brave CallAI"`, `short_name: "CallAI"`
  - `start_url: "/"`
  - `display: "standalone"` (eget vindu uten nettleserchrome)
  - `background_color` og `theme_color`: hentes fra eksisterende designtokens (`#ffffff` / `#3a5c28`)
  - `icons`: to størrelser — `192x192` og `512x512` PNG

- **`public/icons/icon-192.png`** og **`public/icons/icon-512.png`** — genereres fra
  eksisterende `BraveAiFull.png` eller `bravelogo.svg`

- **`app/layout.tsx`** — tilleggsmetadata for iOS:
  ```ts
  appleWebApp: { capable: true, statusBarStyle: "default", title: "CallAI" }
  ```

### Hva vi dropper

Service worker og offline-støtte — ikke relevant for en API-avhengig app.

---

## Del 2: Flytende opptaksknapp (RecordFab)

### Komponent

**`components/record-fab.tsx`** — client component (`"use client"`).

Monteres i **`app/page.tsx`** ved siden av `<CallList>`:

```tsx
<CallList calls={calls} />
<RecordFab />
```

### UI-tilstander

| Tilstand | Innhold |
|---|---|
| **Lukket** | Grønn FAB (`fixed bottom-6 right-6`) med mikrofonikon |
| **Åpen – klar** | Modal overlay: stor record-knapp + lenke «Åpne full versjon» |
| **Under opptak** | Rød stopp-knapp, pulseeffekt, enkel tidtaker (mm:ss). Kun stopp + avbryt |
| **Laster opp** | Spinner, knapper deaktivert |
| **Ferdig** | Modal lukkes, lista refreshes |

Klikk på modal-kortet (utenfor record/avbryt-knappene) mens i **klar**-tilstand → navigerer til `/record`.
Under opptak er denne navigasjonen deaktivert for å unngå utilsiktet avbrudd.

### Opptaksflyt

1. `navigator.mediaDevices.getUserMedia({ audio: true })`
2. `MediaRecorder` med webm-format (samme som eksisterende `/record`-side)
3. Chunks samles i array; `durationSec` telles med `setInterval`
4. Ved stopp: `new Blob(chunks, { type: "audio/webm" })`
5. POST til `POST /api/calls` som multipart:
   - `audio` — Blob
   - `notes` — tom streng (`""`)
   - `durationSec` — antall sekunder
   - `transcribeMode` — `"batch"`
6. API-ruten håndterer Vercel Blob-opplasting, Azure-transkribering og Claude-analyse
   (ingen endringer i API-ruten)
7. Ved suksess: `router.refresh()` for å oppdatere listen

### Avbryt-logikk

Klikk på avbryt: stopper `MediaRecorder`, kaster chunks, lukker modal. Ingen API-kall.

### Feilhåndtering

Ved feil fra API: viser en enkel feilmelding i modalen med «Prøv igjen»-knapp.
Mikrofontillatelse nektet: modal viser feilmelding og lenke til full versjon.

---

## Komponenter og konvensjoner

- Bruker eksisterende `Button`/`buttonVariants`, `Spinner` fra `components/ui/`
- Designtokens fra `app/globals.css` (aksent `#3a5c28`, `bg`, `border`, `ink-soft`)
- Ingen inline Tailwind-knapper — alt via `cn()` + `buttonVariants`
- UI-tekst på norsk

---

## Filer som endres / opprettes

| Fil | Handling |
|---|---|
| `app/manifest.ts` | Ny |
| `public/icons/icon-192.png` | Ny |
| `public/icons/icon-512.png` | Ny |
| `app/layout.tsx` | Legg til `appleWebApp`-metadata |
| `components/record-fab.tsx` | Ny |
| `app/page.tsx` | Importer og monter `<RecordFab />` |

**Ingen endringer** i `app/record/`, API-ruter eller Prisma-skjema.
