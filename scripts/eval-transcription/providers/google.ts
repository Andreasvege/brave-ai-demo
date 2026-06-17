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
  // longRunningRecognize (ikke sync recognize) — sync har 60s-grense; ekte
  // samtaler er lengre. Inline content holder opp til ~10MB (≈5 min WAV);
  // større filer ville krevd GCS-uri.
  const [operation] = await c.longRunningRecognize({
    config: recognitionConfig,
    audio: { content: audioBytes },
  });
  const [response] = await operation.promise();
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
      .streamingRecognize({ config: recognitionConfig, interimResults: true })
      .on("error", reject)
      .on("data", (data: { results?: Array<{ isFinal?: boolean; alternatives?: Array<{ transcript?: string }> }> }) => {
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

    // Config sendes via konstruktør-argumentet over. Streamen wrapper hver
    // write() automatisk som audio_content, så vi skriver RÅ buffere her —
    // ikke { audioContent }-objekter (det ville blitt dobbelt-wrappet).
    (async () => {
      for (const chunk of chunkPcm(wavPath)) {
        stream.write(chunk);
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
