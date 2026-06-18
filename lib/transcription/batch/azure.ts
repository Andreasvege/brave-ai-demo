import type { BatchTranscriber } from "../types";

type FastTranscriptionResponse = {
  durationMilliseconds?: number;
  combinedPhrases?: { text: string }[];
};

export const azureBatch: BatchTranscriber = async (audio, filename) => {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) throw new Error("AZURE_SPEECH_REGION/AZURE_SPEECH_KEY mangler i miljøet");

  const formData = new FormData();
  formData.append("audio", audio, filename);
  formData.append("definition", JSON.stringify({ locales: ["nb-NO"] }));

  const res = await fetch(
    `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`,
    { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key }, body: formData }
  );
  if (!res.ok) throw new Error(`Azure Speech ${res.status}: ${(await res.text()).slice(0, 500)}`);

  const data = (await res.json()) as FastTranscriptionResponse;
  const transcript = (data.combinedPhrases ?? []).map((p) => p.text).join(" ").trim();
  const durationSec = data.durationMilliseconds ? Math.round(data.durationMilliseconds / 1000) : null;
  return { transcript, durationSec };
};
