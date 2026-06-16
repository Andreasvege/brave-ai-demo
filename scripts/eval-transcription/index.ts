import { toWav, wavDurationSec } from "./audio";
import { writeReport } from "./report";
import { azure } from "./providers/azure";
import { aws } from "./providers/aws";
import { google } from "./providers/google";
import { openai } from "./providers/openai";
import { deepgram } from "./providers/deepgram";
import type { ProviderModule, ProviderReport } from "./types";

const providers: ProviderModule[] = [azure, aws, google, openai, deepgram];

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Bruk: npm run eval-transcribe <lydfil>");
    process.exit(1);
  }

  console.log(`Konverterer ${input} → WAV …`);
  const wav = toWav(input);
  const durationSec = wavDurationSec(wav);
  console.log(`Varighet: ${durationSec.toFixed(1)}s`);

  const reports: ProviderReport[] = [];
  for (const p of providers) {
    console.log(`\n=== ${p.name} ===`);
    const report: ProviderReport = {
      name: p.name,
      costPerMinuteUSD: p.costPerMinuteUSD,
    };
    if (p.runBatch) {
      try {
        console.log("  batch …");
        report.batch = await p.runBatch(wav);
      } catch (e) {
        report.batch = {
          transcript: "",
          durationMs: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    if (p.runStreaming) {
      try {
        console.log("  streaming …");
        report.streaming = await p.runStreaming(wav);
      } catch (e) {
        report.streaming = {
          transcript: "",
          timeToFirstWordMs: null,
          totalDurationMs: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    reports.push(report);
  }

  if (reports.length === 0) {
    console.log("\nIngen providers registrert ennå.");
    return;
  }
  const path = writeReport(reports, input, durationSec);
  console.log(`\nRapport skrevet: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
