import OpenAI, { toFile } from "openai";
import type { BatchTranscriber } from "../types";

// Direkte OpenAI batch-transkribering (gpt-4o-transcribe via api.openai.com).
// Bruker OpenAI-klienten direkte — ingen Azure-deployment/region å forholde seg til.
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";

export const openaiBatch: BatchTranscriber = async (audio, filename) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY mangler");
  const client = new OpenAI({ apiKey });
  const file = await toFile(audio, filename);
  const result = await client.audio.transcriptions.create({
    file,
    model: MODEL,
    language: "no",
  });
  return { transcript: result.text.trim(), durationSec: null };
};
