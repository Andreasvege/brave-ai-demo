import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import type { BatchTranscriber } from "../types";
import { blobToPcm, chunkBuffer } from "../audio";

export const awsBatch: BatchTranscriber = async (audio) => {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) throw new Error("AWS_REGION/ACCESS_KEY/SECRET mangler");

  const { pcm, sampleRate } = await blobToPcm(audio);
  const chunks = chunkBuffer(pcm);

  const client = new TranscribeStreamingClient({ region, credentials: { accessKeyId, secretAccessKey } });
  async function* audioStream() {
    for (const c of chunks) yield { AudioEvent: { AudioChunk: new Uint8Array(c) } };
  }

  const response = await client.send(
    new StartStreamTranscriptionCommand({
      LanguageCode: "no-NO",
      MediaSampleRateHertz: sampleRate,
      MediaEncoding: "pcm",
      AudioStream: audioStream(),
    })
  );

  const finals: string[] = [];
  for await (const event of response.TranscriptResultStream ?? []) {
    for (const r of event.TranscriptEvent?.Transcript?.Results ?? []) {
      if (!r.IsPartial && r.Alternatives?.[0]?.Transcript) finals.push(r.Alternatives[0].Transcript);
    }
  }
  return { transcript: finals.join(" ").trim(), durationSec: null };
};
