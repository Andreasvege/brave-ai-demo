import type { LiveTranscriber, ProviderId } from "../types";
import { createAzureSpeechLive } from "./azure-speech";

const LIVE: Partial<Record<ProviderId, () => LiveTranscriber>> = {
  "azure-live": createAzureSpeechLive,
};

export function createLiveTranscriber(providerId: ProviderId): LiveTranscriber {
  const make = LIVE[providerId];
  if (!make) throw new Error(`Ukjent live-leverandør: ${providerId}`);
  return make();
}
