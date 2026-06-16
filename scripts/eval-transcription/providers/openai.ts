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
