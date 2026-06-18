import type { BatchTranscriber, ProviderId } from "../types";
import { azureBatch } from "./azure";
import { azureOpenaiBatch } from "./azure-openai";
import { awsBatch } from "./aws";

// Maps provider id → batch implementation. Only ids present here are runnable;
// the registry may list more (live entries) that have no batch impl.
const BATCH: Partial<Record<ProviderId, BatchTranscriber>> = {
  "azure-batch": azureBatch,
  "azure-openai-batch": azureOpenaiBatch,
  "aws-batch": awsBatch,
};

export async function dispatchBatch(providerId: ProviderId, audio: Blob, filename: string) {
  const fn = BATCH[providerId];
  if (!fn) throw new Error(`Ukjent batch-leverandør: ${providerId}`);
  return fn(audio, filename);
}
