export type BatchResult = {
  transcript: string;
  durationMs: number;
  error?: string;
};

export type StreamingResult = {
  transcript: string;
  timeToFirstWordMs: number | null;
  totalDurationMs: number;
  error?: string;
};

export type ProviderModule = {
  name: string;
  costPerMinuteUSD: number;
  runBatch?: (wavPath: string) => Promise<BatchResult>;
  runStreaming?: (wavPath: string) => Promise<StreamingResult>;
};

export type ProviderReport = {
  name: string;
  costPerMinuteUSD: number;
  batch?: BatchResult;
  streaming?: StreamingResult;
};

export type FileEvaluation = {
  audioFile: string;
  durationSec: number;
  reports: ProviderReport[];
};
