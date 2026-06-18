"use client";

import type { LiveTranscriber } from "../types";
import { startPcmCapture, bytesToBase64, type AudioCapture } from "./audio-capture";

// OpenAI Realtime live-transkribering, direkte mot api.openai.com (gpt-realtime-whisper —
// OpenAIs natively-streaming transkripsjonsmodell, bygget for realtime/lav latency).
// Flyt: hent ephemeral nøkkel + ws-URL fra /api/transcribe-token/openai → åpne WebSocket →
// stream mikrofon-PCM (24 kHz) som input_audio_buffer.append → les delta (interim) +
// completed (final) events.
//
// Protokollen (eventnavnene input_audio_buffer.append / *.transcription.delta/completed)
// er OpenAIs egne realtime-events.
//
// USIKRE PUNKTER (verifiser mot ekte OpenAI-ressurs, juster ved behov):
//  - Browser-WS kan ikke sette headere. Vi sender ephemeral nøkkel via subprotocol
//    `openai-insecure-api-key.<key>` slik OpenAI dokumenterer.
//  - wsUrl peker på /v1/realtime?intent=transcription. Sesjonen er konfigurert i
//    token-ruten via client_secrets; en session.update etter open kan være nødvendig
//    hvis OpenAI ikke fester konfigurasjonen til den ephemeral nøkkelen.

const TARGET_RATE = 24000;

export function createOpenaiRealtimeLive(): LiveTranscriber {
  let ws: WebSocket | null = null;
  let capture: AudioCapture | null = null;
  const finals: string[] = [];
  let interim = "";

  const t: LiveTranscriber = {
    async start() {
      const res = await fetch("/api/transcribe-token/openai", { method: "POST" });
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
        socket.onerror = () => reject(new Error("WebSocket-tilkobling til OpenAI feilet"));
        socket.onmessage = (ev) => handleMessage(ev);
      });

      capture = await startPcmCapture(TARGET_RATE, (bytes) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: bytesToBase64(bytes) }));
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
        t.onError?.(new Error(msg.error?.message || "Realtime-feil fra OpenAI"));
        break;
    }
  }

  return t;
}
