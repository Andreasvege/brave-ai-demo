import { env } from "../config";
import { chunkPcm } from "../audio";
import type { StreamingResult, ProviderModule } from "../types";

// OpenAI Realtime live-transkribering i Node — speiler appens browser-impl
// (lib/transcription/live/openai.ts) og token-ruten (/api/transcribe-token/openai):
//   1. mint ephemeral client_secret med session-config (pcm 24 kHz, modell, language=no)
//   2. åpne WebSocket med subprotokoll ["realtime", "openai-insecure-api-key.<key>"]
//   3. stream 24 kHz PCM i sanntid som input_audio_buffer.append, commit til slutt
//   4. samle conversation.item.input_audio_transcription.{delta,completed}
//
// Node v24 har global WebSocket, så samme protokoll som nettleseren brukes uendret.
// NB: dette er i praksis første ekte ende-til-ende-test av WS-ruten — browser-benet
// ble aldri verifisert live (se CLAUDE.md). Forvent mulig iterasjon på event-navn.

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-whisper";
const SAMPLE_RATE = 24000; // OpenAI Realtime pcm-input
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const DRAIN_MS = 8000; // sikkerhetsnett: fullfør selv om OpenAI ikke signaliserer slutt

async function mintEphemeralKey(): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: SAMPLE_RATE },
            transcription: { model: REALTIME_MODEL, language: "no" },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI client_secret ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { value?: string; client_secret?: { value?: string } };
  const key = data.value ?? data.client_secret?.value;
  if (!key) throw new Error("Fikk ingen ephemeral nøkkel fra OpenAI");
  return key;
}

async function runStreaming(inputWav24k: string): Promise<StreamingResult> {
  if (!env.openaiKey) throw new Error("OPENAI_API_KEY mangler");
  const ephemeralKey = await mintEphemeralKey();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, ["realtime", `openai-insecure-api-key.${ephemeralKey}`]);

    const t0 = Date.now();
    let firstWordMs: number | null = null;
    const finals: string[] = [];
    let interim = "";
    let lastError: string | null = null;

    let settled = false;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      try {
        ws.close();
      } catch {
        /* allerede lukket */
      }
      const transcript = [...finals, interim].join(" ").replace(/\s+/g, " ").trim();
      resolve({
        transcript,
        timeToFirstWordMs: firstWordMs,
        totalDurationMs: Date.now() - t0,
        ...(transcript ? {} : lastError ? { error: lastError } : {}),
      });
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      reject(new Error(lastError ?? "WebSocket-tilkobling til OpenAI feilet"));
    };

    ws.onmessage = (ev) => {
      let msg: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      switch (msg.type) {
        case "conversation.item.input_audio_transcription.delta":
          if (firstWordMs === null) firstWordMs = Date.now() - t0;
          interim += msg.delta ?? "";
          break;
        case "conversation.item.input_audio_transcription.completed": {
          if (firstWordMs === null) firstWordMs = Date.now() - t0;
          const finalText = (msg.transcript ?? "").trim();
          if (finalText) finals.push(finalText);
          interim = "";
          break;
        }
        case "error":
          // Ikke-fatale feil (f.eks. commit på tomt buffer) skal ikke felle kjøringen;
          // vi lar drain-timeout fullføre med det vi har. Lagre for diagnostikk.
          lastError = msg.error?.message ?? "Realtime-feil fra OpenAI";
          break;
      }
    };

    ws.onopen = async () => {
      const chunks = chunkPcm(inputWav24k, 100, SAMPLE_RATE);
      for (const c of chunks) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: c.toString("base64") }));
        await new Promise((r) => setTimeout(r, 100)); // sanntidsmating: 100 ms per 100 ms-chunk
      }
      if (ws.readyState === WebSocket.OPEN) {
        // Tving transkribering av evt. ikke-committet hale (fil kan slutte midt i tale).
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }
      // Etter siste lyd: vent på gjenstående completed-events, så fullfør.
      drainTimer = setTimeout(finish, DRAIN_MS);
    };
  });
}

export const openaiRealtime: ProviderModule = {
  name: "OpenAI Realtime",
  costPerMinuteUSD: 0.006,
  runStreaming,
};
