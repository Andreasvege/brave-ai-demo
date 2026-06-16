import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { toWav, wavDurationSec } from "./audio";
import { writeReport, writeSummary } from "./report";
import { azure } from "./providers/azure";
import { aws } from "./providers/aws";
import { google } from "./providers/google";
import { openai } from "./providers/openai";
import { deepgram } from "./providers/deepgram";
import type { ProviderModule, ProviderReport, FileEvaluation } from "./types";

const providers: ProviderModule[] = [azure, aws, google, openai, deepgram];

const AUDIO_EXT = new Set([
  ".m4a", ".webm", ".wav", ".mp3", ".ogg", ".flac", ".aac", ".mp4",
]);

// Hvert argument kan være en lydfil eller en mappe; mapper ekspanderes til
// lydfilene de inneholder (sortert). Slik kan man kjøre hele lydopptak/ på én gang.
function expandInputs(args: string[]): string[] {
  const files: string[] = [];
  for (const arg of args) {
    if (statSync(arg).isDirectory()) {
      for (const name of readdirSync(arg).sort()) {
        if (AUDIO_EXT.has(extname(name).toLowerCase())) files.push(join(arg, name));
      }
    } else {
      files.push(arg);
    }
  }
  return files;
}

async function evaluateFile(input: string): Promise<FileEvaluation> {
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

  return { audioFile: input, durationSec, reports };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Bruk: npm run eval-transcribe <lydfil|mappe> [flere …]");
    process.exit(1);
  }

  const inputs = expandInputs(args);
  if (inputs.length === 0) {
    console.error("Fant ingen lydfiler i argumentene.");
    process.exit(1);
  }

  const evals: FileEvaluation[] = [];
  for (const [i, input] of inputs.entries()) {
    console.log(`\n########## Fil ${i + 1}/${inputs.length}: ${input} ##########`);
    const ev = await evaluateFile(input);
    const path = writeReport(ev);
    console.log(`\nRapport skrevet: ${path}`);
    evals.push(ev);
  }

  if (evals.length > 1) {
    const summary = writeSummary(evals);
    console.log(`\nSamlerapport skrevet: ${summary}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
