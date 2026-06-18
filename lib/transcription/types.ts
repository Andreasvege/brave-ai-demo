export type TranscribeMode = "batch" | "live";

export type ProviderId =
  | "azure-batch"
  | "azure-openai-batch"
  | "aws-batch"
  | "azure-live"
  | "azure-openai-live"
  | "aws-live";

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  mode: TranscribeMode;
  costPerMinuteUSD: number;
};

// Server-side batch contract. Takes the audio blob + a filename hint, returns
// the transcript and (when the provider reports it) the audio duration.
export type BatchTranscriber = (
  audio: Blob,
  filename: string
) => Promise<{ transcript: string; durationSec: number | null }>;

// Client-side live contract. One implementation per provider; the page never
// branches on provider.
export interface LiveTranscriber {
  start(): Promise<void>;
  stop(): Promise<{ transcript: string }>;
  onPartial?: (text: string) => void; // interim text → live UI
  onFinal?: (text: string) => void; // committed segment
  onError?: (err: Error) => void;
}
