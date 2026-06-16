# Transkripsjonsleverandør-evaluering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygg et frittstående skript som kjører samme lydopptak gjennom Azure, AWS Transcribe, Google Cloud Speech, OpenAI Whisper og Deepgram — i både batch og streaming der det støttes — og produserer en sammenlignende rapport over kvalitet, latency og pris.

**Architecture:** Standalone TypeScript-skript i `scripts/eval-transcription/`, kjørt med `tsx`. Helt adskilt fra Next.js-appen (ingen importer fra `app/` eller `lib/`). Hver leverandør er en egen modul som eksporterer `runBatch()` og/eller `runStreaming()` mot et felles grensesnitt. `index.ts` orkestrerer: konverterer lyd → kjører providers → skriver rapport.

**Tech Stack:** TypeScript, tsx, dotenv, ffmpeg-static, og leverandør-SDKer: `microsoft-cognitiveservices-speech-sdk` (allerede installert), `@aws-sdk/client-transcribe-streaming`, `@google-cloud/speech`, `@deepgram/sdk`, `openai`.

**Verifiseringsfilosofi:** Dette er integrasjonskode mot eksterne API-er. Enhetstester med mockede HTTP-svar verifiserer ingenting nyttig. Verifiseringssløyfen er derfor: kjør provideren mot den ekte testfilen (`lydopptak/testopptak1.m4a`) og inspiser at transkriptet er ikke-tomt og norsk. Hver provider-task verifiseres slik. Skriptet bygges defensivt så én provider-feil ikke stopper de andre.

---

## Filstruktur

```
scripts/eval-transcription/
  index.ts            ← main: parse arg, konverter lyd, kjør providers, skriv rapport
  types.ts            ← BatchResult, StreamingResult, ProviderReport, ProviderModule
  config.ts           ← laster .env.local via dotenv, eksporterer typede env-verdier
  audio.ts            ← m4a → WAV 16kHz/16-bit/mono (ffmpeg-static) + WAV-chunking
  report.ts           ← bygger report.md + raw.json
  providers/
    azure.ts
    aws.ts
    google.ts
    openai.ts
    deepgram.ts
```

**Felles grensesnitt** (alle providers følger dette):

```typescript
type ProviderModule = {
  name: string;
  costPerMinuteUSD: number;
  runBatch?: (wavPath: string) => Promise<BatchResult>;
  runStreaming?: (wavPath: string) => Promise<StreamingResult>;
};
```

---

## Task 1: Prosjektoppsett og avhengigheter

**Files:**
- Modify: `package.json` (devDependencies + script)
- Create: `scripts/eval-transcription/.gitignore`

- [ ] **Step 1: Installer dev-avhengigheter**

Run:
```bash
npm install --save-dev tsx dotenv ffmpeg-static @aws-sdk/client-transcribe-streaming @google-cloud/speech @deepgram/sdk openai
```
Expected: pakkene legges til i `devDependencies` uten feil. (`microsoft-cognitiveservices-speech-sdk` er allerede en dependency.)

- [ ] **Step 2: Legg til npm-script**

I `package.json` under `"scripts"`, legg til:
```json
"eval-transcribe": "tsx scripts/eval-transcription/index.ts"
```

- [ ] **Step 3: Ignorer resultater**

Opprett `scripts/eval-transcription/.gitignore`:
```
# Resultater committes ikke automatisk — kan inneholde transkripter
/../../eval-results/
```
Legg også til i prosjektets rot-`.gitignore` (sjekk at den finnes med `cat .gitignore | grep eval-results || echo "/eval-results/" >> .gitignore`):
```
/eval-results/
```

- [ ] **Step 4: Verifiser tsx kjører**

Run:
```bash
echo 'console.log("tsx ok")' | npx tsx
```
Expected: skriver `tsx ok`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/eval-transcription/.gitignore .gitignore
git commit -m "chore: add transcription eval deps and script"
```

---

## Task 2: Typer og config

**Files:**
- Create: `scripts/eval-transcription/types.ts`
- Create: `scripts/eval-transcription/config.ts`

- [ ] **Step 1: Skriv typene**

Opprett `scripts/eval-transcription/types.ts`:
```typescript
export type BatchResult = {
  transcript: string;
  durationMs: number;
  error?: string;
};

export type StreamingResult = {
  transcript: string;
  timeToFirstWordMs: number | null;
  totalDurationMs: number;
  error?: string;
};

export type ProviderModule = {
  name: string;
  costPerMinuteUSD: number;
  runBatch?: (wavPath: string) => Promise<BatchResult>;
  runStreaming?: (wavPath: string) => Promise<StreamingResult>;
};

export type ProviderReport = {
  name: string;
  costPerMinuteUSD: number;
  batch?: BatchResult;
  streaming?: StreamingResult;
};
```

- [ ] **Step 2: Skriv config-loader**

Opprett `scripts/eval-transcription/config.ts`:
```typescript
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Last .env.local fra prosjektroten (to nivåer opp fra denne filen)
loadEnv({ path: resolve(__dirname, "../../.env.local") });

function opt(name: string): string | undefined {
  return process.env[name];
}

export const env = {
  azureKey: opt("AZURE_SPEECH_KEY"),
  azureRegion: opt("AZURE_SPEECH_REGION"),
  awsAccessKeyId: opt("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: opt("AWS_SECRET_ACCESS_KEY"),
  awsRegion: opt("AWS_REGION"),
  googleCredentials: opt("GOOGLE_APPLICATION_CREDENTIALS"),
  openaiKey: opt("OPENAI_API_KEY"),
  deepgramKey: opt("DEEPGRAM_API_KEY"),
};
```

- [ ] **Step 3: Verifiser typesjekk**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: ingen feil fra de nye filene. (Hvis tsconfig ekskluderer `scripts/`, kjør i stedet `npx tsc --noEmit scripts/eval-transcription/types.ts scripts/eval-transcription/config.ts --moduleResolution node --esModuleInterop` og bekreft ingen feil.)

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/types.ts scripts/eval-transcription/config.ts
git commit -m "feat: add eval types and config loader"
```

---

## Task 3: Lydkonvertering og chunking

**Files:**
- Create: `scripts/eval-transcription/audio.ts`

- [ ] **Step 1: Skriv audio-modulen**

Opprett `scripts/eval-transcription/audio.ts`:
```typescript
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // 16-bit
const CHANNELS = 1;

// Konverter vilkårlig lydfil til WAV 16kHz/16-bit/mono. Returnerer sti til WAV.
export function toWav(inputPath: string): string {
  if (!ffmpegPath) throw new Error("ffmpeg-static fant ingen binærfil");
  const outDir = mkdtempSync(join(tmpdir(), "eval-wav-"));
  const outPath = join(outDir, "audio.wav");
  const res = spawnSync(
    ffmpegPath,
    [
      "-i", inputPath,
      "-ar", String(SAMPLE_RATE),
      "-ac", String(CHANNELS),
      "-sample_fmt", "s16",
      "-y", outPath,
    ],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg feilet: ${res.stderr?.slice(0, 500)}`);
  }
  return outPath;
}

// Les WAV-varighet i sekunder fra rå PCM-data (hopper over 44-byte header).
export function wavDurationSec(wavPath: string): number {
  const buf = readFileSync(wavPath);
  const pcmBytes = buf.length - 44;
  return pcmBytes / (SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS);
}

// Del WAV-PCM (uten header) i biter på ~chunkMs millisekunder.
export function chunkPcm(wavPath: string, chunkMs = 100): Buffer[] {
  const buf = readFileSync(wavPath);
  const pcm = buf.subarray(44); // hopp over standard WAV-header
  const bytesPerChunk =
    Math.floor((SAMPLE_RATE * chunkMs) / 1000) * BYTES_PER_SAMPLE * CHANNELS;
  const chunks: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += bytesPerChunk) {
    chunks.push(pcm.subarray(i, Math.min(i + bytesPerChunk, pcm.length)));
  }
  return chunks;
}

export const AUDIO_FORMAT = { SAMPLE_RATE, BYTES_PER_SAMPLE, CHANNELS };
```

- [ ] **Step 2: Verifiser konvertering mot ekte fil**

Lag en midlertidig smoke-test og kjør den:
```bash
npx tsx -e '
import { toWav, wavDurationSec, chunkPcm } from "./scripts/eval-transcription/audio";
const wav = toWav("lydopptak/testopptak1.m4a");
console.log("WAV:", wav);
console.log("Varighet (s):", wavDurationSec(wav).toFixed(1));
console.log("Antall 100ms-chunks:", chunkPcm(wav).length);
'
```
Expected: skriver en gyldig WAV-sti, en varighet > 0 sekunder, og et chunk-antall ≈ varighet × 10. Ingen ffmpeg-feil.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-transcription/audio.ts
git commit -m "feat: add audio conversion and PCM chunking"
```

---

## Task 4: Rapportgenerator + orkestrator-skall

**Files:**
- Create: `scripts/eval-transcription/report.ts`
- Create: `scripts/eval-transcription/index.ts`

- [ ] **Step 1: Skriv rapportgeneratoren**

Opprett `scripts/eval-transcription/report.ts`:
```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProviderReport } from "./types";

function ms(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toLocaleString("no-NO");
}

export function writeReport(
  reports: ProviderReport[],
  audioFile: string,
  durationSec: number
): string {
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join("eval-results", date);
  mkdirSync(outDir, { recursive: true });

  const rows = reports
    .map(
      (r) =>
        `| ${r.name} | ${ms(r.batch?.durationMs)} | ${ms(
          r.streaming?.timeToFirstWordMs
        )} | $${r.costPerMinuteUSD.toFixed(4)} |`
    )
    .join("\n");

  const batchTranscripts = reports
    .map(
      (r) =>
        `### ${r.name}\n${
          r.batch?.error
            ? `_Feil: ${r.batch.error}_`
            : `> ${r.batch?.transcript || "_(ingen batch-støtte)_"}`
        }`
    )
    .join("\n\n");

  const streamTranscripts = reports
    .map(
      (r) =>
        `### ${r.name}\n${
          r.streaming?.error
            ? `_Feil: ${r.streaming.error}_`
            : `> ${r.streaming?.transcript || "_(ingen streaming-støtte)_"}`
        }`
    )
    .join("\n\n");

  const min = durationSec / 60;
  const costRows = reports
    .map(
      (r) =>
        `| ${r.name} | $${(r.costPerMinuteUSD * min).toFixed(4)} | $${(
          r.costPerMinuteUSD *
          5 *
          200
        ).toFixed(2)} |`
    )
    .join("\n");

  const md = `# Transkripsjonsevaluering — ${date}
Lydfil: ${audioFile} (${Math.floor(durationSec / 60)} min ${Math.round(
    durationSec % 60
  )} sek)

## Metrikk-oversikt
| Provider | Batch (ms) | Streaming TTF (ms) | Kost/min (USD) |
|---|---|---|---|
${rows}

## Transkripter (batch)
${batchTranscripts}

## Transkripter (streaming)
${streamTranscripts}

## Prisberegning
| Provider | Denne filen | 200 samtaler/mnd à 5 min |
|---|---|---|
${costRows}
`;

  const mdPath = join(outDir, "report.md");
  writeFileSync(mdPath, md);
  writeFileSync(
    join(outDir, "raw.json"),
    JSON.stringify({ audioFile, durationSec, reports }, null, 2)
  );
  return mdPath;
}
```

- [ ] **Step 2: Skriv orkestrator-skallet (uten providers ennå)**

Opprett `scripts/eval-transcription/index.ts`:
```typescript
import { toWav, wavDurationSec } from "./audio";
import { writeReport } from "./report";
import type { ProviderModule, ProviderReport } from "./types";

// Providers fylles inn i Task 5–9.
const providers: ProviderModule[] = [];

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Bruk: npm run eval-transcribe <lydfil>");
    process.exit(1);
  }

  console.log(`Konverterer ${input} → WAV …`);
  const wav = toWav(input);
  const durationSec = wavDurationSec(wav);
  console.log(`Varighet: ${durationSec.toFixed(1)}s`);

  const reports: ProviderReport[] = [];
  for (const p of providers) {
    console.log(`\n=== ${p.name} ===`);
    const report: ProviderReport = {
      name: p.name,
      costPerMinuteUSD: p.costPerMinuteUSD,
    };
    if (p.runBatch) {
      try {
        console.log("  batch …");
        report.batch = await p.runBatch(wav);
      } catch (e) {
        report.batch = {
          transcript: "",
          durationMs: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    if (p.runStreaming) {
      try {
        console.log("  streaming …");
        report.streaming = await p.runStreaming(wav);
      } catch (e) {
        report.streaming = {
          transcript: "",
          timeToFirstWordMs: null,
          totalDurationMs: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    reports.push(report);
  }

  if (reports.length === 0) {
    console.log("\nIngen providers registrert ennå.");
    return;
  }
  const path = writeReport(reports, input, durationSec);
  console.log(`\nRapport skrevet: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Verifiser skallet kjører**

Run:
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Expected: konverterer lyd, skriver varighet, og "Ingen providers registrert ennå." Ingen krasj.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/report.ts scripts/eval-transcription/index.ts
git commit -m "feat: add report generator and orchestrator shell"
```

---

## Task 5: Azure-provider (batch + streaming)

**Files:**
- Create: `scripts/eval-transcription/providers/azure.ts`
- Modify: `scripts/eval-transcription/index.ts` (registrer provider)

- [ ] **Step 1: Skriv Azure-provideren**

Opprett `scripts/eval-transcription/providers/azure.ts`. Batch gjenbruker samme Fast Transcription REST-endepunkt som produksjonskoden (`lib/transcribe.ts`); streaming bruker Speech SDK med push-stream.
```typescript
import { readFileSync } from "node:fs";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { env } from "../config";
import { chunkPcm, AUDIO_FORMAT } from "../audio";
import type { BatchResult, StreamingResult, ProviderModule } from "../types";

async function runBatch(wavPath: string): Promise<BatchResult> {
  if (!env.azureKey || !env.azureRegion)
    throw new Error("AZURE_SPEECH_KEY/REGION mangler");
  const t0 = Date.now();
  const form = new FormData();
  const wav = readFileSync(wavPath);
  form.append("audio", new Blob([wav]), "audio.wav");
  form.append("definition", JSON.stringify({ locales: ["nb-NO"] }));
  const res = await fetch(
    `https://${env.azureRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`,
    { method: "POST", headers: { "Ocp-Apim-Subscription-Key": env.azureKey }, body: form }
  );
  if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { combinedPhrases?: { text: string }[] };
  const transcript = (data.combinedPhrases ?? []).map((p) => p.text).join(" ").trim();
  return { transcript, durationMs: Date.now() - t0 };
}

function runStreaming(wavPath: string): Promise<StreamingResult> {
  if (!env.azureKey || !env.azureRegion)
    throw new Error("AZURE_SPEECH_KEY/REGION mangler");
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(env.azureKey!, env.azureRegion!);
    speechConfig.speechRecognitionLanguage = "nb-NO";
    const format = sdk.AudioStreamFormat.getWaveFormatPCM(
      AUDIO_FORMAT.SAMPLE_RATE, 16, AUDIO_FORMAT.CHANNELS
    );
    const pushStream = sdk.AudioInputStream.createPushStream(format);
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    const t0 = Date.now();
    let firstWordMs: number | null = null;
    const parts: string[] = [];

    recognizer.recognizing = () => {
      if (firstWordMs === null) firstWordMs = Date.now() - t0;
    };
    recognizer.recognized = (_s, e) => {
      if (e.result.text) parts.push(e.result.text);
    };
    recognizer.canceled = (_s, e) => {
      recognizer.close();
      if (e.reason === sdk.CancellationReason.Error) reject(new Error(e.errorDetails));
    };
    recognizer.sessionStopped = () => {
      recognizer.close();
      resolve({
        transcript: parts.join(" ").trim(),
        timeToFirstWordMs: firstWordMs,
        totalDurationMs: Date.now() - t0,
      });
    };

    recognizer.startContinuousRecognitionAsync(async () => {
      const chunks = chunkPcm(wavPath);
      for (const c of chunks) {
        pushStream.write(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength));
        await new Promise((r) => setTimeout(r, 10)); // simuler sanntid (raskere enn 100ms for kort kjøretid)
      }
      pushStream.close();
      setTimeout(() => recognizer.stopContinuousRecognitionAsync(), 2000);
    });
  });
}

export const azure: ProviderModule = {
  name: "Azure",
  costPerMinuteUSD: 0.017,
  runBatch,
  runStreaming,
};
```

- [ ] **Step 2: Registrer i index.ts**

I `scripts/eval-transcription/index.ts`, endre import-blokken og providers-arrayet:
```typescript
import { azure } from "./providers/azure";
```
```typescript
const providers: ProviderModule[] = [azure];
```

- [ ] **Step 3: Kjør mot ekte fil**

Run:
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Expected: Azure batch og streaming gir ikke-tomme norske transkripter. Rapport skrives til `eval-results/<dato>/report.md`. Inspiser at begge transkripter ser fornuftige ut.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/providers/azure.ts scripts/eval-transcription/index.ts
git commit -m "feat: add Azure batch+streaming eval provider"
```

---

## Task 6: AWS Transcribe-provider (batch + streaming)

**Files:**
- Create: `scripts/eval-transcription/providers/aws.ts`
- Modify: `scripts/eval-transcription/index.ts`

AWS streaming-API-et brukes for begge moduser — "batch" her betyr at vi mater hele filen gjennom streaming og venter på fullt resultat, slik unngår vi S3-opplasting. TTF måles kun i streaming-kjøringen.

- [ ] **Step 1: Skriv AWS-provideren**

Opprett `scripts/eval-transcription/providers/aws.ts`:
```typescript
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import { env } from "../config";
import { chunkPcm, AUDIO_FORMAT } from "../audio";
import type { BatchResult, StreamingResult, ProviderModule } from "../types";

function client(): TranscribeStreamingClient {
  if (!env.awsAccessKeyId || !env.awsSecretAccessKey || !env.awsRegion)
    throw new Error("AWS_ACCESS_KEY_ID/SECRET/REGION mangler");
  return new TranscribeStreamingClient({
    region: env.awsRegion,
    credentials: {
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey,
    },
  });
}

async function* audioStream(wavPath: string, delayMs: number) {
  for (const chunk of chunkPcm(wavPath)) {
    yield { AudioEvent: { AudioChunk: new Uint8Array(chunk) } };
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}

// Felles kjøring. delayMs=0 → "batch" (så raskt som mulig), delayMs=10 → sanntidssimulering.
async function transcribe(wavPath: string, delayMs: number) {
  const c = client();
  const t0 = Date.now();
  let firstWordMs: number | null = null;
  const finals: string[] = [];

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "no-NO",
    MediaSampleRateHertz: AUDIO_FORMAT.SAMPLE_RATE,
    MediaEncoding: "pcm",
    AudioStream: audioStream(wavPath, delayMs),
  });

  const response = await c.send(command);
  for await (const event of response.TranscriptResultStream ?? []) {
    const results = event.TranscriptEvent?.Transcript?.Results ?? [];
    for (const r of results) {
      if (firstWordMs === null) firstWordMs = Date.now() - t0;
      if (!r.IsPartial && r.Alternatives?.[0]?.Transcript) {
        finals.push(r.Alternatives[0].Transcript);
      }
    }
  }
  return {
    transcript: finals.join(" ").trim(),
    firstWordMs,
    totalMs: Date.now() - t0,
  };
}

async function runBatch(wavPath: string): Promise<BatchResult> {
  const r = await transcribe(wavPath, 0);
  return { transcript: r.transcript, durationMs: r.totalMs };
}

async function runStreaming(wavPath: string): Promise<StreamingResult> {
  const r = await transcribe(wavPath, 10);
  return {
    transcript: r.transcript,
    timeToFirstWordMs: r.firstWordMs,
    totalDurationMs: r.totalMs,
  };
}

export const aws: ProviderModule = {
  name: "AWS Transcribe",
  costPerMinuteUSD: 0.024,
  runBatch,
  runStreaming,
};
```

- [ ] **Step 2: Registrer i index.ts**

```typescript
import { aws } from "./providers/aws";
```
```typescript
const providers: ProviderModule[] = [azure, aws];
```

- [ ] **Step 3: Kjør mot ekte fil**

Run:
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Expected: AWS-seksjonen i rapporten har ikke-tomt norsk transkript for både batch og streaming. Hvis `no-NO` avvises av kontoen, prøv også `en-US` for å bekrefte tilkobling, og noter språkfeil i rapporten — men forventet er at `no-NO` fungerer.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/providers/aws.ts scripts/eval-transcription/index.ts
git commit -m "feat: add AWS Transcribe eval provider"
```

---

## Task 7: Google Cloud Speech-provider (batch + streaming)

**Files:**
- Create: `scripts/eval-transcription/providers/google.ts`
- Modify: `scripts/eval-transcription/index.ts`

- [ ] **Step 1: Skriv Google-provideren**

Opprett `scripts/eval-transcription/providers/google.ts`. Bruker `recognize` (synkron, ≤60s) for batch og `streamingRecognize` for streaming. Begge med Chirp-modell der tilgjengelig.
```typescript
import { readFileSync } from "node:fs";
import speech from "@google-cloud/speech";
import { env } from "../config";
import { chunkPcm, AUDIO_FORMAT } from "../audio";
import type { BatchResult, StreamingResult, ProviderModule } from "../types";

function getClient() {
  if (!env.googleCredentials)
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS mangler");
  return new speech.SpeechClient();
}

const recognitionConfig = {
  encoding: "LINEAR16" as const,
  sampleRateHertz: AUDIO_FORMAT.SAMPLE_RATE,
  languageCode: "nb-NO",
};

async function runBatch(wavPath: string): Promise<BatchResult> {
  const c = getClient();
  const t0 = Date.now();
  const audioBytes = readFileSync(wavPath).subarray(44).toString("base64");
  const [response] = await c.recognize({
    config: recognitionConfig,
    audio: { content: audioBytes },
  });
  const transcript = (response.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
  return { transcript, durationMs: Date.now() - t0 };
}

function runStreaming(wavPath: string): Promise<StreamingResult> {
  const c = getClient();
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let firstWordMs: number | null = null;
    const finals: string[] = [];

    const stream = c
      .streamingRecognize({
        config: recognitionConfig,
        interimResults: true,
      })
      .on("error", reject)
      .on("data", (data: any) => {
        const result = data.results?.[0];
        if (!result) return;
        if (firstWordMs === null) firstWordMs = Date.now() - t0;
        if (result.isFinal && result.alternatives?.[0]?.transcript) {
          finals.push(result.alternatives[0].transcript);
        }
      })
      .on("end", () => {
        resolve({
          transcript: finals.join(" ").trim(),
          timeToFirstWordMs: firstWordMs,
          totalDurationMs: Date.now() - t0,
        });
      });

    (async () => {
      for (const chunk of chunkPcm(wavPath)) {
        stream.write({ audioContent: chunk });
        await new Promise((r) => setTimeout(r, 10));
      }
      stream.end();
    })().catch(reject);
  });
}

export const google: ProviderModule = {
  name: "Google Chirp",
  costPerMinuteUSD: 0.016,
  runBatch,
  runStreaming,
};
```

- [ ] **Step 2: Registrer i index.ts**

```typescript
import { google } from "./providers/google";
```
```typescript
const providers: ProviderModule[] = [azure, aws, google];
```

- [ ] **Step 3: Kjør mot ekte fil**

Run:
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Expected: Google-seksjonen har ikke-tomt norsk transkript for batch og streaming. Merk: hvis testfilen er >60s vil `recognize` feile — da fanges feilen i rapporten. Bekreft testfilens varighet fra konsollutskriften; hvis >60s, noter at batch krever GCS (utenfor scope for denne filen) og at streaming-resultatet fortsatt er gyldig.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/providers/google.ts scripts/eval-transcription/index.ts
git commit -m "feat: add Google Cloud Speech eval provider"
```

---

## Task 8: OpenAI Whisper-provider (batch only)

**Files:**
- Create: `scripts/eval-transcription/providers/openai.ts`
- Modify: `scripts/eval-transcription/index.ts`

- [ ] **Step 1: Skriv OpenAI-provideren**

Opprett `scripts/eval-transcription/providers/openai.ts`:
```typescript
import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { env } from "../config";
import type { BatchResult, ProviderModule } from "../types";

async function runBatch(wavPath: string): Promise<BatchResult> {
  if (!env.openaiKey) throw new Error("OPENAI_API_KEY mangler");
  const client = new OpenAI({ apiKey: env.openaiKey });
  const t0 = Date.now();
  const result = await client.audio.transcriptions.create({
    file: createReadStream(wavPath),
    model: "whisper-1",
    language: "no",
  });
  return { transcript: result.text.trim(), durationMs: Date.now() - t0 };
}

export const openai: ProviderModule = {
  name: "OpenAI Whisper",
  costPerMinuteUSD: 0.006,
  runBatch,
};
```

- [ ] **Step 2: Registrer i index.ts**

```typescript
import { openai } from "./providers/openai";
```
```typescript
const providers: ProviderModule[] = [azure, aws, google, openai];
```

- [ ] **Step 3: Kjør mot ekte fil**

Run:
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Expected: OpenAI Whisper-seksjonen har ikke-tomt norsk batch-transkript. Streaming vises som "_(ingen streaming-støtte)_".

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/providers/openai.ts scripts/eval-transcription/index.ts
git commit -m "feat: add OpenAI Whisper eval provider"
```

---

## Task 9: Deepgram-provider (batch + streaming)

**Files:**
- Create: `scripts/eval-transcription/providers/deepgram.ts`
- Modify: `scripts/eval-transcription/index.ts`

- [ ] **Step 1: Skriv Deepgram-provideren**

Opprett `scripts/eval-transcription/providers/deepgram.ts`. Batch via `transcribeFile`, streaming via live WebSocket-klienten.
```typescript
import { readFileSync } from "node:fs";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { env } from "../config";
import { chunkPcm, AUDIO_FORMAT } from "../audio";
import type { BatchResult, StreamingResult, ProviderModule } from "../types";

function dg() {
  if (!env.deepgramKey) throw new Error("DEEPGRAM_API_KEY mangler");
  return createClient(env.deepgramKey);
}

async function runBatch(wavPath: string): Promise<BatchResult> {
  const client = dg();
  const t0 = Date.now();
  const { result, error } = await client.listen.prerecorded.transcribeFile(
    readFileSync(wavPath),
    { model: "nova-2", language: "no", smart_format: true }
  );
  if (error) throw new Error(error.message ?? String(error));
  const transcript =
    result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  return { transcript, durationMs: Date.now() - t0 };
}

function runStreaming(wavPath: string): Promise<StreamingResult> {
  const client = dg();
  return new Promise((resolve, reject) => {
    const connection = client.listen.live({
      model: "nova-2",
      language: "no",
      encoding: "linear16",
      sample_rate: AUDIO_FORMAT.SAMPLE_RATE,
      channels: AUDIO_FORMAT.CHANNELS,
      smart_format: true,
    });

    const t0 = Date.now();
    let firstWordMs: number | null = null;
    const finals: string[] = [];

    connection.on(LiveTranscriptionEvents.Open, async () => {
      for (const chunk of chunkPcm(wavPath)) {
        connection.send(chunk);
        await new Promise((r) => setTimeout(r, 10));
      }
      connection.finish();
    });
    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      if (firstWordMs === null) firstWordMs = Date.now() - t0;
      const alt = data.channel?.alternatives?.[0]?.transcript;
      if (data.is_final && alt) finals.push(alt);
    });
    connection.on(LiveTranscriptionEvents.Close, () => {
      resolve({
        transcript: finals.join(" ").trim(),
        timeToFirstWordMs: firstWordMs,
        totalDurationMs: Date.now() - t0,
      });
    });
    connection.on(LiveTranscriptionEvents.Error, (err: any) =>
      reject(new Error(err?.message ?? String(err)))
    );
  });
}

export const deepgram: ProviderModule = {
  name: "Deepgram",
  costPerMinuteUSD: 0.0059,
  runBatch,
  runStreaming,
};
```

- [ ] **Step 2: Registrer i index.ts**

```typescript
import { deepgram } from "./providers/deepgram";
```
```typescript
const providers: ProviderModule[] = [azure, aws, google, openai, deepgram];
```

- [ ] **Step 3: Kjør hele suiten**

Run:
```bash
npm run eval-transcribe lydopptak/testopptak1.m4a
```
Expected: alle fem providers gir resultater (eller tydelige feilmeldinger der nøkler mangler). Rapporten har komplett metrikk-tabell, alle batch- og streaming-transkripter, og prisberegning.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-transcription/providers/deepgram.ts scripts/eval-transcription/index.ts
git commit -m "feat: add Deepgram eval provider"
```

---

## Task 10: README og opprydding

**Files:**
- Create: `scripts/eval-transcription/README.md`

- [ ] **Step 1: Skriv README**

Opprett `scripts/eval-transcription/README.md`:
```markdown
# Transkripsjonsevaluering

Sammenligner Azure, AWS Transcribe, Google Cloud Speech, OpenAI Whisper og
Deepgram på norsk tale-til-tekst — batch og streaming.

## Forutsetninger
- ffmpeg følger med via `ffmpeg-static` (ingen systeminstallasjon nødvendig)
- Nøkler i `.env.local` (se under)

## Miljøvariabler
\`\`\`
AZURE_SPEECH_KEY, AZURE_SPEECH_REGION        # finnes allerede
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
GOOGLE_APPLICATION_CREDENTIALS               # sti til service account JSON
OPENAI_API_KEY
DEEPGRAM_API_KEY
\`\`\`
Providers uten nøkler hopper over med en feilmelding i rapporten — resten kjører.

## Kjøring
\`\`\`bash
npm run eval-transcribe lydopptak/testopptak1.m4a
\`\`\`

## Resultat
Skrives til \`eval-results/<dato>/report.md\` (lesbar) og \`raw.json\` (rådata).
Resultatmappa er git-ignorert (kan inneholde transkripter).
```

- [ ] **Step 2: Verifiser hele typesjekken**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: ingen feil. (Hvis `scripts/` er ekskludert fra tsconfig, bekreft i stedet at `npm run eval-transcribe lydopptak/testopptak1.m4a` kjører uten runtime-typefeil.)

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-transcription/README.md
git commit -m "docs: add eval-transcription README"
```

---

## Self-Review-notater

- **Spec-dekning:** Alle fem providers (Task 5–9), batch+streaming der støttet, m4a→WAV-konvertering (Task 3), 100ms-chunking (Task 3, brukt i alle streaming-providers), rapport med metrikk/transkripter/pris (Task 4), miljøvariabler (Task 2 + README). ✅
- **Type-konsistens:** `ProviderModule`, `BatchResult`, `StreamingResult`, `ProviderReport` definert i Task 2, brukt uendret i Task 4–9. `AUDIO_FORMAT` definert i Task 3, brukt i alle streaming-providers. ✅
- **Defensiv kjøring:** `index.ts` (Task 4) fanger feil per provider/modus så manglende nøkler eller språkfeil ikke stopper suiten. ✅
- **Kjente forbehold dokumentert i tasks:** Google batch ≤60s (Task 7 Step 3), AWS språkkode-fallback (Task 6 Step 3), Whisper ingen streaming (Task 8).
