import { readFileSync } from "node:fs";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { env } from "../config";
import { chunkPcm, AUDIO_FORMAT } from "../audio";
import type { BatchResult, StreamingResult, ProviderModule } from "../types";

async function runBatch(wavPath: string): Promise<BatchResult> {
  if (!env.azureKey || !env.azureRegion)
    throw new Error("AZURE_SPEECH_KEY/REGION mangler");
  const t0 = Date.now();
  const form = new FormData();
  const wav = readFileSync(wavPath);
  form.append("audio", new Blob([wav]), "audio.wav");
  form.append("definition", JSON.stringify({ locales: ["nb-NO"] }));
  const res = await fetch(
    `https://${env.azureRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`,
    { method: "POST", headers: { "Ocp-Apim-Subscription-Key": env.azureKey }, body: form }
  );
  if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { combinedPhrases?: { text: string }[] };
  const transcript = (data.combinedPhrases ?? []).map((p) => p.text).join(" ").trim();
  return { transcript, durationMs: Date.now() - t0 };
}

function runStreaming(wavPath: string): Promise<StreamingResult> {
  if (!env.azureKey || !env.azureRegion)
    throw new Error("AZURE_SPEECH_KEY/REGION mangler");
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(env.azureKey!, env.azureRegion!);
    speechConfig.speechRecognitionLanguage = "nb-NO";
    const format = sdk.AudioStreamFormat.getWaveFormatPCM(
      AUDIO_FORMAT.SAMPLE_RATE, 16, AUDIO_FORMAT.CHANNELS
    );
    const pushStream = sdk.AudioInputStream.createPushStream(format);
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    const t0 = Date.now();
    let firstWordMs: number | null = null;
    const parts: string[] = [];

    // Resolver nøyaktig én gang. Azure kan signalere slutt via sessionStopped,
    // canceled(EndOfStream), eller — som sikkerhetsnett — vår egen drain-timeout.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      recognizer.stopContinuousRecognitionAsync(
        () => {
          recognizer.close();
          resolve({
            transcript: parts.join(" ").trim(),
            timeToFirstWordMs: firstWordMs,
            totalDurationMs: Date.now() - t0,
          });
        },
        () => {
          recognizer.close();
          resolve({
            transcript: parts.join(" ").trim(),
            timeToFirstWordMs: firstWordMs,
            totalDurationMs: Date.now() - t0,
          });
        }
      );
    };

    recognizer.recognizing = () => {
      if (firstWordMs === null) firstWordMs = Date.now() - t0;
    };
    recognizer.recognized = (_s, e) => {
      if (e.result.text) parts.push(e.result.text);
    };
    recognizer.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        if (settled) return;
        settled = true;
        recognizer.close();
        reject(new Error(e.errorDetails));
      } else {
        // EndOfStream e.l. — naturlig slutt, fullfør normalt
        finish();
      }
    };
    recognizer.sessionStopped = () => finish();

    recognizer.startContinuousRecognitionAsync(async () => {
      const chunks = chunkPcm(wavPath);
      for (const c of chunks) {
        // Kopier til en ren ArrayBuffer (c.buffer kan være SharedArrayBuffer for tsc)
        const ab = new ArrayBuffer(c.byteLength);
        new Uint8Array(ab).set(c);
        pushStream.write(ab);
        await new Promise((r) => setTimeout(r, 100)); // sanntidsmating: 100ms per 100ms-chunk
      }
      pushStream.close();
      // Sikkerhetsnett: hvis Azure ikke selv signaliserer slutt innen drain-vinduet,
      // fullfør likevel slik at harnesset aldri henger.
      setTimeout(finish, 8000);
    });
  });
}

export const azure: ProviderModule = {
  name: "Azure",
  costPerMinuteUSD: 0.017,
  runBatch,
  runStreaming,
};
