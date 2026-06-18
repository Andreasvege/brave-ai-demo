"use client";

import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import type { LiveTranscriber } from "../types";
import { startPcmCapture, type AudioCapture } from "./audio-capture";

// AWS Transcribe streaming live, browser-direkte. Flyt: hent kortlevde STS-creds fra
// /api/transcribe-token/aws → åpne streaming-tilkobling med SDK-en (den håndterer AWS
// event-stream-rammingen) → mat mikrofon-PCM (16 kHz) → les partial/final results.
//
// USIKRE PUNKTER (test mot ekte konto): at AWS SDK kjører rent i nettleseren med temp-creds,
// og at IAM tillater transcribe:StartStreamTranscription.

const TARGET_RATE = 16000;

// Bygger en async-iterabel av AudioEvents matet fra capture-callbacken (push) til SDK-en (pull).
function createAudioPipe() {
  const queue: Uint8Array[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(bytes: Uint8Array) {
      queue.push(bytes);
      wake?.();
      wake = null;
    },
    end() {
      ended = true;
      wake?.();
      wake = null;
    },
    async *stream(): AsyncGenerator<{ AudioEvent: { AudioChunk: Uint8Array } }> {
      while (true) {
        if (queue.length) {
          yield { AudioEvent: { AudioChunk: queue.shift()! } };
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

export function createAwsStreamingLive(): LiveTranscriber {
  let capture: AudioCapture | null = null;
  let client: TranscribeStreamingClient | null = null;
  const pipe = createAudioPipe();
  const finals: string[] = [];
  let interim = "";

  const t: LiveTranscriber = {
    async start() {
      const res = await fetch("/api/transcribe-token/aws", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente AWS-credentials");
      const { region, accessKeyId, secretAccessKey, sessionToken } = data as {
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken: string;
      };

      client = new TranscribeStreamingClient({
        region,
        credentials: { accessKeyId, secretAccessKey, sessionToken },
      });

      capture = await startPcmCapture(TARGET_RATE, (bytes) => pipe.push(bytes));

      const response = await client.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: "no-NO",
          MediaSampleRateHertz: TARGET_RATE,
          MediaEncoding: "pcm",
          AudioStream: pipe.stream(),
        })
      );

      // Les resultatstrømmen i bakgrunnen; partial → interim, final → akkumuler.
      void (async () => {
        try {
          for await (const event of response.TranscriptResultStream ?? []) {
            for (const r of event.TranscriptEvent?.Transcript?.Results ?? []) {
              const text = r.Alternatives?.[0]?.Transcript ?? "";
              if (!text) continue;
              if (r.IsPartial) {
                interim = text;
                t.onPartial?.(text);
              } else {
                finals.push(text);
                t.onFinal?.(text);
                interim = "";
              }
            }
          }
        } catch (e) {
          t.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    },

    async stop() {
      capture?.stop();
      capture = null;
      pipe.end();
      client?.destroy();
      client = null;
      const transcript = [...finals, interim].join(" ").replace(/\s+/g, " ").trim();
      return { transcript };
    },
  };

  return t;
}
