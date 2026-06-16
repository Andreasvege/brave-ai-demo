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

// Felles kjøring. delayMs=0 → "batch" (så raskt som mulig — AWS venter på full stream, ingen avkutting),
// delayMs=100 → sanntidssimulering for streaming (gyldig TTF, ingen avkutting).
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
  const r = await transcribe(wavPath, 100);
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
