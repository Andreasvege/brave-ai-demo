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
