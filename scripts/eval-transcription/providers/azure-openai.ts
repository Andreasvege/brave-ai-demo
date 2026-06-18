import { createReadStream } from "node:fs";
import { AzureOpenAI } from "openai";
import { env } from "../config";
import type { BatchResult, ProviderModule } from "../types";

// Azure OpenAI-transkribering (gpt-4o-transcribe / gpt-4o-mini-transcribe / whisper).
// Egen Azure-ressurs, IKKE Azure Speech. Hvilken modell som testes styres av hvilken
// deployment du peker på via AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT.
//
// gpt-4o-transcribe-familien krever en preview-api-version; whisper går på GA. Default
// under er trygg for gpt-4o-transcribe; overstyr med AZURE_OPENAI_API_VERSION ved behov.
const DEFAULT_API_VERSION = "2025-03-01-preview";

async function runBatch(wavPath: string): Promise<BatchResult> {
  const { azureOpenaiEndpoint, azureOpenaiKey, azureOpenaiDeployment } = env;
  if (!azureOpenaiEndpoint || !azureOpenaiKey || !azureOpenaiDeployment) {
    throw new Error(
      "AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_KEY/AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT mangler"
    );
  }
  const client = new AzureOpenAI({
    endpoint: azureOpenaiEndpoint,
    apiKey: azureOpenaiKey,
    apiVersion: env.azureOpenaiApiVersion ?? DEFAULT_API_VERSION,
    deployment: azureOpenaiDeployment,
  });

  const t0 = Date.now();
  const result = await client.audio.transcriptions.create({
    file: createReadStream(wavPath),
    model: azureOpenaiDeployment, // Azure ruter på deployment-navn, ikke modell-id
    language: "no",
  });
  return { transcript: result.text.trim(), durationMs: Date.now() - t0 };
}

export const azureOpenai: ProviderModule = {
  // Navnet vises i rapportene; deployment-valget avgjør hvilken modell tallene gjelder.
  name: "Azure OpenAI",
  costPerMinuteUSD: 0.006, // ~gpt-4o-transcribe; mini ≈ 0.003. Juster ved endelig valg.
  runBatch,
};
