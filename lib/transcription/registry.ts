import type { ProviderId, ProviderMeta, TranscribeMode } from "./types";

// Single source of truth for which providers exist. Pure data so it is safe to
// import from both server (dispatcher) and client (ModelSelect). aws-live is
// added in its own plan.
export const PROVIDERS: ProviderMeta[] = [
  { id: "azure-batch", label: "Azure Speech", mode: "batch", costPerMinuteUSD: 0.017 },
  { id: "openai-batch", label: "OpenAI (gpt-4o-transcribe)", mode: "batch", costPerMinuteUSD: 0.006 },
  { id: "aws-batch", label: "AWS Transcribe", mode: "batch", costPerMinuteUSD: 0.024 },
  { id: "azure-live", label: "Azure Speech (live)", mode: "live", costPerMinuteUSD: 0.017 },
  { id: "openai-live", label: "OpenAI Realtime (gpt-realtime-whisper)", mode: "live", costPerMinuteUSD: 0.006 },
  { id: "aws-live", label: "AWS Transcribe (live)", mode: "live", costPerMinuteUSD: 0.024 },
];

export function providersByMode(mode: TranscribeMode): ProviderMeta[] {
  return PROVIDERS.filter((p) => p.mode === mode);
}

export function providerById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const DEFAULT_PROVIDER: Record<TranscribeMode, ProviderId> = {
  batch: "azure-batch",
  live: "aws-live",
};
