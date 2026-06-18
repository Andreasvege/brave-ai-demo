import type { ProviderId, ProviderMeta, TranscribeMode } from "./types";

// Single source of truth for which providers exist. Pure data so it is safe to
// import from both server (dispatcher) and client (ModelSelect). aws-live is
// added in its own plan.
export const PROVIDERS: ProviderMeta[] = [
  { id: "azure-batch", label: "Azure Speech", mode: "batch", costPerMinuteUSD: 0.017 },
  { id: "azure-openai-batch", label: "Azure OpenAI (gpt-4o-transcribe)", mode: "batch", costPerMinuteUSD: 0.006 },
  { id: "aws-batch", label: "AWS Transcribe", mode: "batch", costPerMinuteUSD: 0.024 },
  { id: "azure-live", label: "Azure Speech (live)", mode: "live", costPerMinuteUSD: 0.017 },
  { id: "aws-live", label: "AWS Transcribe (live)", mode: "live", costPerMinuteUSD: 0.024 },
  // azure-openai-live er IMPLEMENTERT (factory + /api/transcribe-token + live/azure-openai.ts)
  // men IKKE tilbudt i dropdownen: Azure OpenAI realtime-transkribering er region-/
  // deployment-skjør (type:transcription → 500, ingen gyldig transcribe-deployment i
  // EU-regionen). Azure OpenAI beholdes som batch-kandidat. Legg raden tilbake her hvis en
  // gyldig gpt-4o-transcribe-deployment finnes i Sweden Central/East US 2 og proben blir grønn.
];

export function providersByMode(mode: TranscribeMode): ProviderMeta[] {
  return PROVIDERS.filter((p) => p.mode === mode);
}

export function providerById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const DEFAULT_PROVIDER: Record<TranscribeMode, ProviderId> = {
  batch: "azure-batch",
  live: "azure-live",
};
