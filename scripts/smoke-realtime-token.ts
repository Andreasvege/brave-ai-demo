// Diagnostic: what realtime/transcription paths does this Azure OpenAI resource
// actually support?  Runs server-side with the API key.
//   npx tsx scripts/smoke-realtime-token.ts
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../.env.local") });

const base = (process.env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/$/, "");
const key = process.env.AZURE_OPENAI_KEY ?? "";
const deployment = process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT ?? "";

async function hit(label: string, u: string, method: string, body?: unknown) {
  const res = await fetch(u, {
    method,
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  console.log(`\n=== ${label} === HTTP ${res.status}`);
  console.log((await res.text()).slice(0, 600));
}

async function main() {
  console.log(`resource: ${base}\ndeployment(env): ${deployment}`);

  // 1) What's deployed on this resource? (data-plane deployment list)
  await hit("GET deployments", `${base}/openai/deployments?api-version=2023-05-15`, "GET");

  // 2) Older preview realtime sessions endpoint (conversational) — exists?
  await hit(
    "PREVIEW sessions (type realtime via model)",
    `${base}/openai/realtimeapi/sessions?api-version=2025-04-01-preview`,
    "POST",
    { model: deployment }
  );

  // 3) Preview transcription_sessions with an older api-version, in case the version is the 404.
  await hit(
    "PREVIEW transcription_sessions api-version 2024-10-01-preview",
    `${base}/openai/realtimeapi/transcription_sessions?api-version=2024-10-01-preview`,
    "POST",
    { input_audio_transcription: { model: deployment } }
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
