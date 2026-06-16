import { readFileSync } from "node:fs";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { env } from "../config";
import { chunkPcm, AUDIO_FORMAT } from "../audio";
import type { BatchResult, StreamingResult, ProviderModule } from "../types";

function dg() {
  if (!env.deepgramKey) throw new Error("DEEPGRAM_API_KEY mangler");
  return createClient(env.deepgramKey);
}

async function runBatch(wavPath: string): Promise<BatchResult> {
  const client = dg();
  const t0 = Date.now();
  const { result, error } = await client.listen.prerecorded.transcribeFile(
    readFileSync(wavPath),
    { model: "nova-2", language: "no", smart_format: true }
  );
  if (error) throw new Error(error.message ?? String(error));
  const transcript =
    result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  return { transcript, durationMs: Date.now() - t0 };
}

function runStreaming(wavPath: string): Promise<StreamingResult> {
  const client = dg();
  return new Promise((resolve, reject) => {
    const connection = client.listen.live({
      model: "nova-2",
      language: "no",
      encoding: "linear16",
      sample_rate: AUDIO_FORMAT.SAMPLE_RATE,
      channels: AUDIO_FORMAT.CHANNELS,
      smart_format: true,
    });

    const t0 = Date.now();
    let firstWordMs: number | null = null;
    const finals: string[] = [];

    connection.on(LiveTranscriptionEvents.Open, async () => {
      for (const chunk of chunkPcm(wavPath)) {
        // Kopier til en ren ArrayBuffer (Buffer godtas ikke av send-typen)
        const ab = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(ab).set(chunk);
        connection.send(ab);
        await new Promise((r) => setTimeout(r, 100)); // sanntidsmating
      }
      connection.finish();
    });
    type DgTranscript = {
      is_final?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string }> };
    };
    connection.on(LiveTranscriptionEvents.Transcript, (data: DgTranscript) => {
      if (firstWordMs === null) firstWordMs = Date.now() - t0;
      const alt = data.channel?.alternatives?.[0]?.transcript;
      if (data.is_final && alt) finals.push(alt);
    });
    connection.on(LiveTranscriptionEvents.Close, () => {
      resolve({
        transcript: finals.join(" ").trim(),
        timeToFirstWordMs: firstWordMs,
        totalDurationMs: Date.now() - t0,
      });
    });
    connection.on(LiveTranscriptionEvents.Error, (err: unknown) =>
      reject(new Error(err instanceof Error ? err.message : String(err)))
    );
  });
}

export const deepgram: ProviderModule = {
  name: "Deepgram",
  costPerMinuteUSD: 0.0059,
  runBatch,
  runStreaming,
};
