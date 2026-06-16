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
        await new Promise((r) => setTimeout(r, 100)); // sanntidsmating
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
