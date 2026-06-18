"use client";

import type { LiveTranscriber } from "../types";
import { startPcmCapture, type AudioCapture } from "./audio-capture";

// Azure OpenAI Realtime live-transkribering (gpt-4o-transcribe).
// Flyt: hent ephemeral nøkkel + ws-URL fra /api/transcribe-token/azure-openai →
// åpne WebSocket → stream mikrofon-PCM (24 kHz) som input_audio_buffer.append →
// les delta (interim) + completed (final) events.
//
// USIKRE PUNKTER (test mot ekte ressurs, juster ved behov):
//  - Browser-WS kan ikke sette headere. Vi sender ephemeral nøkkel via subprotocol
//    slik OpenAI dokumenterer; Azure kan kreve en annen mekanisme (query/WebRTC).
//  - wsUrl peker på GA /openai/v1/realtime?intent=transcription — kan trenge
//    deployment-param eller en session.update etter open.

const TARGET_RATE = 24000;

export function createAzureOpenaiRealtimeLive(): LiveTranscriber {
  let ws: WebSocket | null = null;
  let capture: AudioCapture | null = null;
  const finals: string[] = [];
  let interim = "";

  const t: LiveTranscriber = {
    async start() {
      const res = await fetch("/api/transcribe-token/azure-openai", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente realtime-token");
      const { ephemeralKey, wsUrl } = data as { ephemeralKey: string; wsUrl: string };

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(wsUrl, [
          "realtime",
          `openai-insecure-api-key.${ephemeralKey}`,
        ]);
        socket.onopen = () => {
          ws = socket;
          resolve();
        };
        socket.onerror = () => reject(new Error("WebSocket-tilkobling til Azure feilet"));
        socket.onmessage = (ev) => handleMessage(ev);
      });

      capture = await startPcmCapture(TARGET_RATE, (b64) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
        }
      });
    },

    async stop() {
      capture?.stop();
      capture = null;
      ws?.close();
      ws = null;
      const transcript = [...finals, interim].join(" ").replace(/\s+/g, " ").trim();
      return { transcript };
    },
  };

  function handleMessage(ev: MessageEvent) {
    let msg: {
      type?: string;
      delta?: string;
      transcript?: string;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "conversation.item.input_audio_transcription.delta":
        interim += msg.delta ?? "";
        t.onPartial?.(interim);
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const finalText = (msg.transcript ?? "").trim();
        if (finalText) {
          finals.push(finalText);
          t.onFinal?.(finalText);
        }
        interim = "";
        break;
      }
      case "error":
        t.onError?.(new Error(msg.error?.message || "Realtime-feil fra Azure"));
        break;
    }
  }

  return t;
}
