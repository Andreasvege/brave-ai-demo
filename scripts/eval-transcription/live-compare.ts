import { toWav, wavDurationSec } from "./audio";
import { azure } from "./providers/azure";
import { aws } from "./providers/aws";
import { openaiRealtime } from "./providers/openai-realtime";
import type { ProviderModule, StreamingResult } from "./types";

// Slank live-only-sammenligning: mat inn ÉN lydfil, få de tre live-transkriptene
// (Azure, AWS, OpenAI Realtime) rett i terminalen. Ingen scoring/pris/rapportfiler —
// det er den store harnessen (index.ts) sin jobb. Se README.

// Azure/AWS streamer 16 kHz PCM; OpenAI Realtime krever 24 kHz. Hver provider får
// derfor WAV-varianten den forventer.
const providers: { module: ProviderModule; sampleRate: number }[] = [
  { module: azure, sampleRate: 16000 },
  { module: aws, sampleRate: 16000 },
  { module: openaiRealtime, sampleRate: 24000 },
];

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Bruk: npm run eval-live <lydfil>");
    process.exit(1);
  }

  // Konverter én gang per nødvendig sample rate (16 k og 24 k), gjenbruk på tvers.
  const wavByRate = new Map<number, string>();
  for (const { sampleRate } of providers) {
    if (!wavByRate.has(sampleRate)) wavByRate.set(sampleRate, toWav(input, sampleRate));
  }
  const durationSec = wavDurationSec(wavByRate.get(16000)!, 16000);
  console.log(`Fil: ${input}  (~${durationSec.toFixed(1)}s)`);
  console.log("Streamer i sanntid mot Azure, AWS og OpenAI Realtime parallelt …\n");

  const results = await Promise.allSettled(
    providers.map(({ module, sampleRate }) =>
      module.runStreaming!(wavByRate.get(sampleRate)!)
    )
  );

  results.forEach((res, i) => {
    const name = providers[i].module.name;
    console.log(`\n========== ${name} ==========`);
    if (res.status === "rejected") {
      console.log(`FEIL: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
      return;
    }
    const r: StreamingResult = res.value;
    if (r.error) console.log(`(advarsel: ${r.error})`);
    const ttf = r.timeToFirstWordMs === null ? "—" : `${r.timeToFirstWordMs} ms`;
    console.log(`first-word: ${ttf}  |  total: ${r.totalDurationMs} ms`);
    console.log(r.transcript || "(tomt transkript)");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
