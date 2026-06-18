# Transcription Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick the transcription model hands-on in the demo — a batch dropdown (Azure Speech, Azure OpenAI gpt-4o-transcribe, AWS) and a live dropdown (Azure Speech now; two more in later plans), with the choice stored per call and shown as a badge.

**Architecture:** A shared provider registry (pure metadata) is the single source of truth. Batch runs server-side through a dispatcher that maps a provider id to one transcriber module. Live runs browser-direct behind a `LiveTranscriber` interface; the server only mints short-lived tokens. UI reads the registry; the choice persists to `localStorage` so the FAB/PiP inherit it, and is sent with the call + stored in a new `transcribeProvider` column.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + Neon Postgres, Azure Speech Fast Transcription REST, Azure OpenAI (`openai` SDK `AzureOpenAI`), `@aws-sdk/client-transcribe-streaming`, `ffmpeg-static`, Vercel Blob.

## Global Constraints

- Next.js 16 App Router — read `node_modules/next/dist/docs/` before changing routing/conventions (AGENTS.md).
- Do NOT upgrade Prisma to 7. Schema changes use `prisma db push` (NOT `prisma migrate dev`).
- Always pass the Vercel Blob token explicitly: `{ access: "private", token: process.env.BLOB_READ_WRITE_TOKEN }`.
- All UI copy in Norwegian. Light Linear aesthetic, accent `#3a5c28`. Build UI from `components/ui/` primitives + `cn()`; no inline Tailwind buttons in pages.
- `position: fixed` global UI lives in `layout.tsx` (not inside `.fade-up`).
- No unit-test runner in this repo. Per-task verification = `npx tsc --noEmit` green + `npm run lint` green, plus the smoke/manual check named in the task. `npx next typegen` may be needed before `tsc` in a fresh worktree.
- The three recording surfaces (`/record`, `components/record-fab.tsx`, `components/pip-record-content.tsx`) share the recording pattern — keep them consistent. PiP renders into its own document → inline styles, not Tailwind.
- Provider ids are the stored contract. Batch: `azure-batch`, `azure-openai-batch`, `aws-batch`. Live: `azure-live` (+ `azure-openai-live`, `aws-live` in later plans).
- `registry.ts` and `types.ts` must stay import-safe for both server and client — they must NOT import any provider implementation module (those pull in `fs`/SDKs/browser-only code).

---

## Phase 1 — Batch multi-provider (shippable on its own)

### Task 1: Provider registry + shared types

**Files:**
- Create: `lib/transcription/types.ts`
- Create: `lib/transcription/registry.ts`

**Interfaces:**
- Produces:
  - `type TranscribeMode = "batch" | "live"`
  - `type ProviderId = "azure-batch" | "azure-openai-batch" | "aws-batch" | "azure-live" | "azure-openai-live" | "aws-live"`
  - `type ProviderMeta = { id: ProviderId; label: string; mode: TranscribeMode; costPerMinuteUSD: number }`
  - `type BatchTranscriber = (audio: Blob, filename: string) => Promise<{ transcript: string; durationSec: number | null }>`
  - `interface LiveTranscriber { start(): Promise<void>; stop(): Promise<{ transcript: string }>; onPartial?: (t: string) => void; onFinal?: (t: string) => void; onError?: (e: Error) => void; }`
  - `PROVIDERS: ProviderMeta[]`, `providersByMode(mode): ProviderMeta[]`, `providerById(id): ProviderMeta | undefined`

- [ ] **Step 1: Create the types module**

```ts
// lib/transcription/types.ts
export type TranscribeMode = "batch" | "live";

export type ProviderId =
  | "azure-batch"
  | "azure-openai-batch"
  | "aws-batch"
  | "azure-live"
  | "azure-openai-live"
  | "aws-live";

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  mode: TranscribeMode;
  costPerMinuteUSD: number;
};

// Server-side batch contract. Takes the audio blob + a filename hint, returns
// the transcript and (when the provider reports it) the audio duration.
export type BatchTranscriber = (
  audio: Blob,
  filename: string
) => Promise<{ transcript: string; durationSec: number | null }>;

// Client-side live contract. One implementation per provider; the page never
// branches on provider.
export interface LiveTranscriber {
  start(): Promise<void>;
  stop(): Promise<{ transcript: string }>;
  onPartial?: (text: string) => void; // interim text → live UI
  onFinal?: (text: string) => void; // committed segment
  onError?: (err: Error) => void;
}
```

- [ ] **Step 2: Create the registry (pure metadata — no implementation imports)**

```ts
// lib/transcription/registry.ts
import type { ProviderId, ProviderMeta, TranscribeMode } from "./types";

// Single source of truth for which providers exist. Pure data so it is safe to
// import from both server (dispatcher) and client (ModelSelect). Live entries
// for azure-openai/aws are added in their own plans.
export const PROVIDERS: ProviderMeta[] = [
  { id: "azure-batch", label: "Azure Speech", mode: "batch", costPerMinuteUSD: 0.017 },
  { id: "azure-openai-batch", label: "Azure OpenAI (gpt-4o-transcribe)", mode: "batch", costPerMinuteUSD: 0.006 },
  { id: "aws-batch", label: "AWS Transcribe", mode: "batch", costPerMinuteUSD: 0.024 },
  { id: "azure-live", label: "Azure Speech (live)", mode: "live", costPerMinuteUSD: 0.017 },
];

export function providersByMode(mode: TranscribeMode): ProviderMeta[] {
  return PROVIDERS.filter((p) => p.mode === mode);
}

export function providerById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const DEFAULT_PROVIDER: Record<TranscribeMode, ProviderId> = {
  batch: "azure-batch",
  live: "azure-live",
};
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/transcription/types.ts lib/transcription/registry.ts
git commit -m "feat: transcription provider registry + shared types"
```

---

### Task 2: Batch dispatcher + Azure batch provider

**Files:**
- Create: `lib/transcription/batch/azure.ts`
- Create: `lib/transcription/batch/index.ts`

**Interfaces:**
- Consumes: `BatchTranscriber`, `ProviderId` (Task 1).
- Produces:
  - `azureBatch: BatchTranscriber`
  - `dispatchBatch(providerId: ProviderId, audio: Blob, filename: string): Promise<{ transcript: string; durationSec: number | null }>` — throws `Error("Ukjent batch-leverandør: <id>")` for ids without a batch impl.

- [ ] **Step 1: Port the current Azure Fast Transcription into a BatchTranscriber**

This is the existing `lib/transcribe.ts` logic, unchanged behaviour, wrapped to the new type.

```ts
// lib/transcription/batch/azure.ts
import type { BatchTranscriber } from "../types";

type FastTranscriptionResponse = {
  durationMilliseconds?: number;
  combinedPhrases?: { text: string }[];
};

export const azureBatch: BatchTranscriber = async (audio, filename) => {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) throw new Error("AZURE_SPEECH_REGION/AZURE_SPEECH_KEY mangler i miljøet");

  const formData = new FormData();
  formData.append("audio", audio, filename);
  formData.append("definition", JSON.stringify({ locales: ["nb-NO"] }));

  const res = await fetch(
    `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`,
    { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key }, body: formData }
  );
  if (!res.ok) throw new Error(`Azure Speech ${res.status}: ${(await res.text()).slice(0, 500)}`);

  const data = (await res.json()) as FastTranscriptionResponse;
  const transcript = (data.combinedPhrases ?? []).map((p) => p.text).join(" ").trim();
  const durationSec = data.durationMilliseconds ? Math.round(data.durationMilliseconds / 1000) : null;
  return { transcript, durationSec };
};
```

- [ ] **Step 2: Create the dispatcher**

```ts
// lib/transcription/batch/index.ts
import type { BatchTranscriber, ProviderId } from "../types";
import { azureBatch } from "./azure";

// Maps provider id → batch implementation. Only ids present here are runnable;
// the registry may list more (live entries) that have no batch impl.
const BATCH: Partial<Record<ProviderId, BatchTranscriber>> = {
  "azure-batch": azureBatch,
};

export async function dispatchBatch(providerId: ProviderId, audio: Blob, filename: string) {
  const fn = BATCH[providerId];
  if (!fn) throw new Error(`Ukjent batch-leverandør: ${providerId}`);
  return fn(audio, filename);
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/transcription/batch/azure.ts lib/transcription/batch/index.ts
git commit -m "feat: batch dispatcher with Azure provider"
```

---

### Task 3: Azure OpenAI batch provider (gpt-4o-transcribe)

**Files:**
- Create: `lib/transcription/batch/azure-openai.ts`
- Modify: `lib/transcription/batch/index.ts` (register the id)

**Interfaces:**
- Consumes: `BatchTranscriber`, `dispatchBatch` map (Task 2).
- Produces: `azureOpenaiBatch: BatchTranscriber`.

- [ ] **Step 1: Implement the provider via the AzureOpenAI SDK**

The `openai` SDK exposes `AzureOpenAI` (verified installed). It accepts a `File`/Blob with a name through `toFile`.

```ts
// lib/transcription/batch/azure-openai.ts
import { AzureOpenAI, toFile } from "openai";
import type { BatchTranscriber } from "../types";

// gpt-4o-transcribe needs a preview api-version; override with AZURE_OPENAI_API_VERSION.
const DEFAULT_API_VERSION = "2025-03-01-preview";

export const azureOpenaiBatch: BatchTranscriber = async (audio, filename) => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT;
  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      "AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_KEY/AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT mangler"
    );
  }
  const client = new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? DEFAULT_API_VERSION,
    deployment,
  });
  const file = await toFile(audio, filename);
  const result = await client.audio.transcriptions.create({
    file,
    model: deployment, // Azure routes on deployment name
    language: "no",
  });
  return { transcript: result.text.trim(), durationSec: null };
};
```

- [ ] **Step 2: Register it in the dispatcher**

```ts
// lib/transcription/batch/index.ts — update imports + map
import { azureOpenaiBatch } from "./azure-openai";
// ...
const BATCH: Partial<Record<ProviderId, BatchTranscriber>> = {
  "azure-batch": azureBatch,
  "azure-openai-batch": azureOpenaiBatch,
};
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/transcription/batch/azure-openai.ts lib/transcription/batch/index.ts
git commit -m "feat: Azure OpenAI gpt-4o-transcribe batch provider"
```

---

### Task 4: AWS batch provider (ffmpeg → PCM → streaming-collect)

**Files:**
- Create: `lib/transcription/audio.ts` (server-only ffmpeg helper)
- Create: `lib/transcription/batch/aws.ts`
- Modify: `lib/transcription/batch/index.ts` (register the id)

**Interfaces:**
- Consumes: `BatchTranscriber`, `dispatchBatch` map.
- Produces:
  - `blobToPcm(audio: Blob): Promise<{ pcm: Buffer; sampleRate: number }>` — writes blob to a temp file, runs ffmpeg-static to 16 kHz/mono/s16, returns headerless PCM.
  - `awsBatch: BatchTranscriber`.

AWS streaming needs raw PCM; the route only has a compressed blob. `ffmpeg-static` is already a dependency and bundles a binary that also works on Vercel.

- [ ] **Step 1: Server-only audio helper (adapted from scripts/eval-transcription/audio.ts)**

```ts
// lib/transcription/audio.ts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const SAMPLE_RATE = 16000;

// Convert an arbitrary audio Blob to headerless 16 kHz/mono/s16 PCM.
export async function blobToPcm(audio: Blob): Promise<{ pcm: Buffer; sampleRate: number }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static fant ingen binærfil");
  const dir = mkdtempSync(join(tmpdir(), "stt-"));
  const inPath = join(dir, "in");
  const outPath = join(dir, "out.wav");
  writeFileSync(inPath, Buffer.from(await audio.arrayBuffer()));
  const res = spawnSync(
    ffmpegPath,
    ["-i", inPath, "-ar", String(SAMPLE_RATE), "-ac", "1", "-sample_fmt", "s16", "-y", outPath],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(`ffmpeg feilet: ${res.stderr?.slice(0, 500)}`);
  const wav = readFileSync(outPath);
  return { pcm: wav.subarray(44), sampleRate: SAMPLE_RATE }; // drop 44-byte WAV header
}

export function chunkBuffer(buf: Buffer, chunkBytes = 16000 * 2 / 10): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunkBytes) {
    chunks.push(buf.subarray(i, Math.min(i + chunkBytes, buf.length)));
  }
  return chunks;
}
```

- [ ] **Step 2: AWS batch provider — stream PCM at full speed, collect finals**

Mirrors the harness `runBatch` (delayMs=0): AWS waits for the full stream and returns final results, no real-time pacing.

```ts
// lib/transcription/batch/aws.ts
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import type { BatchTranscriber } from "../types";
import { blobToPcm, chunkBuffer } from "../audio";

export const awsBatch: BatchTranscriber = async (audio) => {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) throw new Error("AWS_REGION/ACCESS_KEY/SECRET mangler");

  const { pcm, sampleRate } = await blobToPcm(audio);
  const chunks = chunkBuffer(pcm);

  const client = new TranscribeStreamingClient({ region, credentials: { accessKeyId, secretAccessKey } });
  async function* audioStream() {
    for (const c of chunks) yield { AudioEvent: { AudioChunk: new Uint8Array(c) } };
  }

  const response = await client.send(
    new StartStreamTranscriptionCommand({
      LanguageCode: "no-NO",
      MediaSampleRateHertz: sampleRate,
      MediaEncoding: "pcm",
      AudioStream: audioStream(),
    })
  );

  const finals: string[] = [];
  for await (const event of response.TranscriptResultStream ?? []) {
    for (const r of event.TranscriptEvent?.Transcript?.Results ?? []) {
      if (!r.IsPartial && r.Alternatives?.[0]?.Transcript) finals.push(r.Alternatives[0].Transcript);
    }
  }
  return { transcript: finals.join(" ").trim(), durationSec: null };
};
```

- [ ] **Step 3: Register it**

```ts
// lib/transcription/batch/index.ts — add
import { awsBatch } from "./aws";
// ...
const BATCH: Partial<Record<ProviderId, BatchTranscriber>> = {
  "azure-batch": azureBatch,
  "azure-openai-batch": azureOpenaiBatch,
  "aws-batch": awsBatch,
};
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Smoke-test all three batch providers (hits real APIs — incurs cost)**

Create a throwaway script and run it against a sample file. Confirms the dispatcher + all three providers return non-empty transcripts.

```ts
// scripts/smoke-batch.ts
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../.env.local") });
import { dispatchBatch } from "../lib/transcription/batch";
import type { ProviderId } from "../lib/transcription/types";

async function main() {
  const path = "lydopptak/testopptak1.m4a";
  const buf = readFileSync(path);
  const blob = new Blob([buf], { type: "audio/mp4" });
  for (const id of ["azure-batch", "azure-openai-batch", "aws-batch"] as ProviderId[]) {
    try {
      const r = await dispatchBatch(id, blob, "testopptak1.m4a");
      console.log(`\n=== ${id} ===\n${r.transcript.slice(0, 200)}`);
    } catch (e) {
      console.log(`\n=== ${id} FEIL ===\n${e instanceof Error ? e.message : e}`);
    }
  }
}
main();
```

Run: `npx tsx scripts/smoke-batch.ts`
Expected: three sections, each with a non-empty Norwegian transcript snippet.

- [ ] **Step 6: Commit (keep the smoke script — it is a useful manual check)**

```bash
git add lib/transcription/audio.ts lib/transcription/batch/aws.ts lib/transcription/batch/index.ts scripts/smoke-batch.ts
git commit -m "feat: AWS batch provider via ffmpeg PCM + streaming-collect"
```

---

### Task 5: Add `transcribeProvider` DB column

**Files:**
- Modify: `prisma/schema.prisma:14-29` (Call model)

**Interfaces:**
- Produces: `Call.transcribeProvider: String?` available to Prisma client.

- [ ] **Step 1: Add the column to the Call model**

```prisma
// prisma/schema.prisma — inside model Call, after transcribeMode
  transcribeMode String?
  transcribeProvider String?
```

- [ ] **Step 2: Push the schema (NOT migrate dev) and regenerate the client**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." and the client regenerates.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (new field visible on the Prisma type).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add transcribeProvider column to Call"
```

---

### Task 6: Wire dispatcher + transcribeProvider into POST /api/calls

**Files:**
- Modify: `app/api/calls/route.ts` (read field, store it, dispatch by provider)

**Interfaces:**
- Consumes: `dispatchBatch` (Task 2), `providerById`/`DEFAULT_PROVIDER` (Task 1), `Call.transcribeProvider` (Task 5).
- Produces: the pipeline transcribes via the chosen batch provider and persists `transcribeProvider`.

- [ ] **Step 1: Replace the Azure-only call with the dispatcher**

In `app/api/calls/route.ts`:

1. Replace the import `import { transcribeAudio } from "@/lib/transcribe";` with:
```ts
import { dispatchBatch } from "@/lib/transcription/batch";
import { providerById, DEFAULT_PROVIDER } from "@/lib/transcription/registry";
import type { ProviderId } from "@/lib/transcription/types";
```

2. After the existing `const transcribeMode = ...` line (route.ts:22), read + validate the provider:
```ts
const rawProvider = (formData.get("transcribeProvider") as string | null) || null;
const providerMeta = rawProvider ? providerById(rawProvider) : undefined;
// Falls back to the mode default if the client omitted/sent an unknown provider.
const transcribeProvider: ProviderId =
  (providerMeta?.id as ProviderId) ?? DEFAULT_PROVIDER[transcribeMode === "live" ? "live" : "batch"];
```

3. In the `prisma.call.create({ data: { ... } })` block (route.ts:38-46), add `transcribeProvider,` to `data`.

4. Replace `const result = await transcribeAudio(audioBlob, filename);` (route.ts:85) with:
```ts
const result = await dispatchBatch(transcribeProvider, audioBlob, filename);
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`lib/transcribe.ts` is now unused but leave it; removal is Task 8 cleanup.)

- [ ] **Step 3: Manual browser smoke — batch via curl is blocked by auth, so verify in the next UI task.**

For now confirm the dev server boots without error.
Run: `npm run dev` (then Ctrl-C)
Expected: compiles, no module errors for the route.

- [ ] **Step 4: Commit**

```bash
git add app/api/calls/route.ts
git commit -m "feat: route transcription through provider dispatcher"
```

---

### Task 7: ModelSelect component + client default helper

**Files:**
- Create: `lib/transcription/client.ts` (localStorage default helpers)
- Create: `components/model-select.tsx` (domain component reading the registry)

**Interfaces:**
- Consumes: `providersByMode`, `DEFAULT_PROVIDER` (Task 1).
- Produces:
  - `getDefaultProvider(mode: TranscribeMode): ProviderId`
  - `setDefaultProvider(mode: TranscribeMode, id: ProviderId): void`
  - `<ModelSelect mode value onChange disabled />` where `value: ProviderId`, `onChange: (id: ProviderId) => void`.

- [ ] **Step 1: localStorage helpers (client-safe, registry-backed defaults)**

```ts
// lib/transcription/client.ts
import { DEFAULT_PROVIDER, providerById } from "./registry";
import type { ProviderId, TranscribeMode } from "./types";

const KEY = (mode: TranscribeMode) => `transcribeProvider:${mode}`;

export function getDefaultProvider(mode: TranscribeMode): ProviderId {
  if (typeof window === "undefined") return DEFAULT_PROVIDER[mode];
  const stored = window.localStorage.getItem(KEY(mode));
  const meta = stored ? providerById(stored) : undefined;
  return meta && meta.mode === mode ? (meta.id as ProviderId) : DEFAULT_PROVIDER[mode];
}

export function setDefaultProvider(mode: TranscribeMode, id: ProviderId): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY(mode), id);
}
```

- [ ] **Step 2: ModelSelect — styled native select, Norwegian, registry-driven**

```tsx
// components/model-select.tsx
"use client";

import { providersByMode } from "@/lib/transcription/registry";
import type { ProviderId, TranscribeMode } from "@/lib/transcription/types";
import { cn } from "@/lib/utils";

export function ModelSelect({
  mode,
  value,
  onChange,
  disabled,
}: {
  mode: TranscribeMode;
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
}) {
  const options = providersByMode(mode);
  return (
    <label className="mt-3 flex w-full max-w-xs flex-col gap-1">
      <span className="kicker">Modell</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ProviderId)}
        className={cn(
          "w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-ink",
          "outline-none transition-colors focus:border-accent-ink focus:bg-surface",
          "disabled:opacity-40"
        )}
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/transcription/client.ts components/model-select.tsx
git commit -m "feat: ModelSelect component + persisted provider default"
```

---

### Task 8: Wire ModelSelect into /record (batch) and send the provider

**Files:**
- Modify: `app/record/page.tsx` (state, dropdown render, submitFile form field)
- Delete: `lib/transcribe.ts` (now unused — confirm no other importers first)

**Interfaces:**
- Consumes: `<ModelSelect>`, `getDefaultProvider`/`setDefaultProvider`, `ProviderId`.
- Produces: batch calls POST `transcribeProvider`; choice persisted.

- [ ] **Step 1: Confirm `lib/transcribe.ts` has no remaining importers**

Run: `grep -rn "lib/transcribe\"" app lib components scripts || echo "no importers"`
Expected: `no importers` (Task 6 was the last one). If any remain, update them to `dispatchBatch` before deleting.

- [ ] **Step 2: Add provider state + persistence to RecordPage**

In `app/record/page.tsx`, add imports:
```ts
import { ModelSelect } from "@/components/model-select";
import { getDefaultProvider, setDefaultProvider } from "@/lib/transcription/client";
import type { ProviderId } from "@/lib/transcription/types";
```

After `const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>("batch");` (page.tsx:30) add:
```ts
const [provider, setProvider] = useState<ProviderId>("azure-batch");
// Load the persisted default for the active mode on mount + whenever mode flips.
useEffect(() => {
  setProvider(getDefaultProvider(transcribeMode));
}, [transcribeMode]);

function chooseProvider(id: ProviderId) {
  setProvider(id);
  setDefaultProvider(transcribeMode, id);
}
```

- [ ] **Step 3: Render the dropdown under the mode toggle**

In the JSX, immediately after the mode-toggle `</div>` and its helper `<p>` (page.tsx:369-374), add:
```tsx
<ModelSelect
  mode={transcribeMode}
  value={provider}
  onChange={chooseProvider}
  disabled={isRecording || phase === "connecting"}
/>
```

- [ ] **Step 4: Send the provider with batch uploads**

In `submitFile` (page.tsx:295-299), after `formData.append("transcribeMode", mode);` add:
```ts
formData.append("transcribeProvider", provider);
```

- [ ] **Step 5: Verify typecheck + lint, then delete the dead module**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.
Then: `git rm lib/transcribe.ts && npx tsc --noEmit`
Expected: still no errors.

- [ ] **Step 6: Manual browser test (the real check)**

Run: `npm run dev`, open `/record`, pick each batch model, record a short clip (or upload `lydopptak/testopptak1.m4a`), submit.
Expected: pipeline completes to DONE for all three; reload `/record` and the last-picked model is preselected.

- [ ] **Step 7: Commit**

```bash
git add app/record/page.tsx
git commit -m "feat: batch model dropdown on /record + send provider"
```

---

### Task 9: Provider badge on the call detail page

**Files:**
- Modify: `components/call-badges.tsx` (add `ProviderBadge`)
- Modify: `app/calls/[id]/page.tsx` (render it where the status/mode badges are)

**Interfaces:**
- Consumes: `providerById` (Task 1), `Call.transcribeProvider` (Task 5).
- Produces: `<ProviderBadge providerId={string | null} />` — renders the registry label, or nothing if unknown/null.

- [ ] **Step 1: Add the badge**

```tsx
// components/call-badges.tsx — append
import { providerById } from "@/lib/transcription/registry";

export function ProviderBadge({ providerId }: { providerId: string | null }) {
  const meta = providerId ? providerById(providerId) : undefined;
  if (!meta) return null;
  return <Badge tone="neutral">{meta.label}</Badge>;
}
```

- [ ] **Step 2: Render it on the detail page**

Open `app/calls/[id]/page.tsx`, find where `StatusBadge`/`OutcomeBadge` are rendered, add alongside:
```tsx
<ProviderBadge providerId={call.transcribeProvider} />
```
(Import `ProviderBadge` from `@/components/call-badges`. If the call object is typed locally, ensure the type includes `transcribeProvider: string | null`.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open a call you transcribed in Task 8.
Expected: a badge shows the model that produced the transcript (e.g. "Azure OpenAI (gpt-4o-transcribe)").

- [ ] **Step 5: Commit**

```bash
git add components/call-badges.tsx app/calls/[id]/page.tsx
git commit -m "feat: show transcription model badge on call detail"
```

**Phase 1 ships here:** batch dropdown with three providers, persisted default, stored + displayed per call.

---

## Phase 2 — Live refactor behind LiveTranscriber

This phase changes **no behaviour** — it extracts the existing Azure Speech live code behind the `LiveTranscriber` interface and wires the live dropdown (with Azure as the only live option for now). It proves the abstraction so the later live-provider plans (Azure OpenAI Realtime, AWS Streaming) just add one module + one registry entry each.

### Task 10: Extract Azure Speech live into a LiveTranscriber + factory

**Files:**
- Create: `lib/transcription/live/azure-speech.ts`
- Create: `lib/transcription/live/index.ts` (factory)

**Interfaces:**
- Consumes: `LiveTranscriber`, `ProviderId` (Task 1); existing `POST /api/speech-token`.
- Produces:
  - `createAzureSpeechLive(): LiveTranscriber`
  - `createLiveTranscriber(providerId: ProviderId): LiveTranscriber` — throws `Error("Ukjent live-leverandør: <id>")` for ids without a live impl.

- [ ] **Step 1: Implement the Azure Speech LiveTranscriber (logic lifted from record/page.tsx:95-201)**

```ts
// lib/transcription/live/azure-speech.ts
import type { SpeechRecognizer } from "microsoft-cognitiveservices-speech-sdk";
import type { LiveTranscriber } from "../types";

export function createAzureSpeechLive(): LiveTranscriber {
  let rec: SpeechRecognizer | null = null;
  const phrases: string[] = [];
  let interim = "";

  const t: LiveTranscriber = {
    async start() {
      const tokenRes = await fetch("/api/speech-token", { method: "POST" });
      const { token, region, error } = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(error || "Kunne ikke hente taletoken");

      const sdk = await import("microsoft-cognitiveservices-speech-sdk");
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = "nb-NO";
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const r = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      r.recognizing = (_s, e) => {
        interim = e.result.text;
        t.onPartial?.(e.result.text);
      };
      r.recognized = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
          phrases.push(e.result.text);
          t.onFinal?.(e.result.text);
        }
        interim = "";
      };
      r.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.Error) t.onError?.(new Error(e.errorDetails));
      };

      await new Promise<void>((resolve, reject) => r.startContinuousRecognitionAsync(resolve, reject));
      rec = r;
    },
    async stop() {
      if (rec) {
        await new Promise<void>((resolve) => rec!.stopContinuousRecognitionAsync(resolve, () => resolve()));
        rec.close();
        rec = null;
      }
      const transcript = [...phrases, interim].join(" ").replace(/\s+/g, " ").trim();
      return { transcript };
    },
  };
  return t;
}
```

- [ ] **Step 2: Factory**

```ts
// lib/transcription/live/index.ts
import type { LiveTranscriber, ProviderId } from "../types";
import { createAzureSpeechLive } from "./azure-speech";

const LIVE: Partial<Record<ProviderId, () => LiveTranscriber>> = {
  "azure-live": createAzureSpeechLive,
};

export function createLiveTranscriber(providerId: ProviderId): LiveTranscriber {
  const make = LIVE[providerId];
  if (!make) throw new Error(`Ukjent live-leverandør: ${providerId}`);
  return make();
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/transcription/live/azure-speech.ts lib/transcription/live/index.ts
git commit -m "feat: Azure Speech live behind LiveTranscriber interface"
```

---

### Task 11: Refactor /record live path to the factory + wire live dropdown

**Files:**
- Modify: `app/record/page.tsx` (replace inline Azure SDK live with the factory; send provider on live submit)

**Interfaces:**
- Consumes: `createLiveTranscriber` (Task 10), existing `provider` state (Task 8).
- Produces: live recording runs through the selected live provider; `submitLive` sends `transcribeProvider`.

- [ ] **Step 1: Swap the recognizer ref for a LiveTranscriber ref**

In `app/record/page.tsx`:
- Add import: `import { createLiveTranscriber } from "@/lib/transcription/live";` and `import type { LiveTranscriber } from "@/lib/transcription/types";`
- Replace `const recognizer = useRef<SpeechRecognizer | null>(null);` (page.tsx:45) with:
```ts
const live = useRef<LiveTranscriber | null>(null);
```
- Remove the now-unused `import type { SpeechRecognizer } ...` (page.tsx:5).

- [ ] **Step 2: Rewrite `startLive` to use the factory**

Replace the body of `startLive` (page.tsx:95-141) with:
```ts
async function startLive() {
  const t = createLiveTranscriber(provider);
  t.onPartial = (text) => { interimRef.current = text; setInterim(text); };
  t.onFinal = (text) => {
    phrasesRef.current = [...phrasesRef.current, text];
    setPhrases(phrasesRef.current);
    interimRef.current = "";
    setInterim("");
  };
  t.onError = (err) => { setError(`Transkribering avbrutt: ${err.message}`); setPhase("error"); };

  phrasesRef.current = [];
  interimRef.current = "";
  setPhrases([]);
  setInterim("");
  await t.start();
  live.current = t;

  startedAt.current = Date.now();
  setSeconds(0);
  timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
  setPhase("recording");
}
```

- [ ] **Step 3: Rewrite `stopLive` and the live branch of `abortRecording`**

Replace `stopLive` (page.tsx:181-201) with:
```ts
async function stopLive() {
  const t = live.current;
  if (!t) return;
  const { transcript } = await t.stop();
  live.current = null;
  const cleaned = transcript.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    setError("Ingen tale ble gjenkjent — transkriptet er tomt.");
    setPhase("error");
    return;
  }
  await submitLive(cleaned, Math.round((Date.now() - startedAt.current) / 1000));
}
```
In `abortRecording` (page.tsx:220-232), replace the live branch (`const rec = recognizer.current; ...`) with:
```ts
if (live.current) { await live.current.stop(); live.current = null; }
phrasesRef.current = [];
interimRef.current = "";
setPhrases([]);
setInterim("");
```
Also update the cleanup `useEffect` (page.tsx:65) `recognizer.current?.close();` → `live.current?.stop();`.

- [ ] **Step 4: Send the provider on live submit**

In `submitLive` (page.tsx:255-259), after `formData.append("transcribeMode", "live");` add:
```ts
formData.append("transcribeProvider", provider);
```

- [ ] **Step 5: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual browser test — live behaviour unchanged**

Run: `npm run dev`, open `/record`, switch to Live (dropdown shows "Azure Speech (live)"), record while speaking.
Expected: interim text appears while speaking, final phrases accumulate, submit reaches DONE, detail badge reads "Azure Speech (live)". Identical to pre-refactor behaviour.

- [ ] **Step 7: Commit**

```bash
git add app/record/page.tsx
git commit -m "refactor: drive /record live through LiveTranscriber factory"
```

---

### Task 12: FAB + PiP inherit the persisted provider default

**Files:**
- Modify: `components/record-fab.tsx`
- Modify: `components/pip-record-content.tsx`

**Interfaces:**
- Consumes: `getDefaultProvider` (Task 7).
- Produces: both quick-record surfaces send `transcribeProvider` matching the user's last `/record` choice for that mode.

- [ ] **Step 1: Read each surface's recording mode + submit code**

Run: `grep -n "transcribeMode\|formData.append\|append(\"transcribe" components/record-fab.tsx components/pip-record-content.tsx`
Expected: locate where each appends `transcribeMode` to its FormData.

- [ ] **Step 2: Append the stored default provider in each surface**

In each file, import `getDefaultProvider` from `@/lib/transcription/client` and, right where it appends `transcribeMode`, append the matching provider. For a batch surface:
```ts
formData.append("transcribeProvider", getDefaultProvider("batch"));
```
For a live submit path use `getDefaultProvider("live")`. (PiP uses inline styles and its own document — no UI change, just the FormData field.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual check**

Run: `npm run dev`. On `/record` pick "AWS Transcribe" (batch), then record via the FAB.
Expected: the resulting call's badge reads "AWS Transcribe" — the FAB inherited the choice.

- [ ] **Step 5: Commit**

```bash
git add components/record-fab.tsx components/pip-record-content.tsx
git commit -m "feat: FAB + PiP inherit persisted transcription provider"
```

---

## Out of scope for this plan (own plans later)

- **Azure OpenAI Realtime live** (`azure-openai-live`) — ephemeral session token endpoint + Realtime WebSocket `LiveTranscriber`. Needs iteration against the real Realtime API.
- **AWS Transcribe Streaming live** (`aws-live`) — browser streaming via SigV4 presign / STS creds. Fiddliest auth; server-relay fallback if browser-direct fights Vercel.
- Each later plan: add one `lib/transcription/live/<provider>.ts`, register it in the factory, add a `/api/transcribe-token/[provider]` branch, add the registry entry. No `/record` changes needed — the factory + dropdown already handle new live ids.
- **Pre-disabling unconfigured providers in the dropdown** (the spec's `available: false`): deferred deliberately. It would require a server-side env check fed to the client, which breaks the registry's client-purity. Instead, a missing key surfaces as a clearly-named `FAILED` call ("Azure OpenAI: … mangler") via the dispatcher's thrown error — acceptable for a hands-on research tool. Revisit if dead options prove annoying.

## Deploy checklist (when moving past local)

- Add to Vercel (Production+Preview): `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT` (AWS + Azure Speech vars already there).
- Confirm `ffmpeg-static` binary runs in the Vercel function (AWS batch path). If not, gate `aws-batch` behind a runtime availability check or move it to a real S3 batch job.
- IAM for AWS creds must allow `transcribe:StartStreamTranscription`.
</content>
