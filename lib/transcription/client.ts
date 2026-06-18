import { DEFAULT_PROVIDER, providerById } from "./registry";
import type { ProviderId, TranscribeMode } from "./types";

const KEY = (mode: TranscribeMode) => `transcribeProvider:${mode}`;

export function getDefaultProvider(mode: TranscribeMode): ProviderId {
  if (typeof window === "undefined") return DEFAULT_PROVIDER[mode];
  const stored = window.localStorage.getItem(KEY(mode));
  const meta = stored ? providerById(stored) : undefined;
  return meta && meta.mode === mode ? (meta.id as ProviderId) : DEFAULT_PROVIDER[mode];
}

export function setDefaultProvider(mode: TranscribeMode, id: ProviderId): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY(mode), id);
}
