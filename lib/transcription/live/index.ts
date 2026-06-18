import type { LiveTranscriber, ProviderId } from "../types";
import { createAzureSpeechLive } from "./azure-speech";
import { createAzureOpenaiRealtimeLive } from "./azure-openai";
import { createAwsStreamingLive } from "./aws";

const LIVE: Partial<Record<ProviderId, () => LiveTranscriber>> = {
  "azure-live": createAzureSpeechLive,
  "azure-openai-live": createAzureOpenaiRealtimeLive,
  "aws-live": createAwsStreamingLive,
};

export function createLiveTranscriber(providerId: ProviderId): LiveTranscriber {
  const make = LIVE[providerId];
  if (!make) throw new Error(`Ukjent live-leverandør: ${providerId}`);
  return make();
}
