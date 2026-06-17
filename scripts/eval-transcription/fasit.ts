// Fasit = håndskrevet «korrekt» transkript per fil, brukt som referanse for WER/CER.
// Ligger i samme mappe som detaljrapporten: eval-results/<dato>/<slug>/fasit.txt
// (git-ignorert — inneholder ekte salgskall). Linjer som starter med # er
// instruksjoner og ignoreres. En uredigert stub beholder en # TODO-markør, slik at
// scoringen hopper over den (ellers ville seed-utkastet gitt falsk 0 % WER).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderReport } from "./types";

const TODO_MARKER = "# TODO";

export function fasitPath(reportDir: string): string {
  return join(reportDir, "fasit.txt");
}

export type Fasit =
  | { state: "missing" }
  | { state: "todo" } // stub finnes, men er ikke rettet enda
  | { state: "ready"; text: string };

// Leser fasit og fjerner #-kommentarlinjer. «todo» hvis TODO-markøren står igjen.
export function readFasit(reportDir: string): Fasit {
  const path = fasitPath(reportDir);
  if (!existsSync(path)) return { state: "missing" };
  const raw = readFileSync(path, "utf8");
  if (raw.includes(TODO_MARKER)) return { state: "todo" };
  const text = raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .trim();
  if (!text) return { state: "todo" };
  return { state: "ready", text };
}

// Beste batch-transkript som redigerbart utkast (rett mot lyden). Streaming som siste utvei.
const SEED_PRIORITY = ["AWS Transcribe", "Azure", "Deepgram", "Google Chirp", "OpenAI Whisper"];

function seedDraft(reports: ProviderReport[]): { provider: string; text: string } | null {
  const byName = new Map(reports.map((r) => [r.name, r]));
  for (const name of SEED_PRIORITY) {
    const r = byName.get(name);
    const batch = r?.batch && !r.batch.error ? r.batch.transcript.trim() : "";
    if (batch) return { provider: `${name} (batch)`, text: batch };
  }
  for (const name of SEED_PRIORITY) {
    const r = byName.get(name);
    const stream = r?.streaming && !r.streaming.error ? r.streaming.transcript.trim() : "";
    if (stream) return { provider: `${name} (streaming)`, text: stream };
  }
  return null;
}

// Skriver en fasit-stub hvis ingen finnes. Returnerer true hvis en ble opprettet.
export function ensureFasitStub(
  reportDir: string,
  audioName: string,
  reports: ProviderReport[]
): boolean {
  const path = fasitPath(reportDir);
  if (existsSync(path)) return false;
  const seed = seedDraft(reports);
  const lines = [
    `# FASIT for ${audioName}`,
    `# Skriv det KORREKTE, ordrette transkriptet under (rett mot lyden).`,
    `# Linjer som starter med # ignoreres i scoringen.`,
    `# ${TODO_MARKER.slice(2)}: fjern denne linja når fasiten er ferdig rettet —`,
    `#       ellers hopper eval-score over fila.`,
    seed
      ? `# Utkast under = ${seed.provider}. RETT det mot lyden, ikke stol blindt på det.`
      : `# (Ingen provider leverte et utkast — skriv fra bunnen.)`,
    ``,
    seed ? seed.text : ``,
    ``,
  ];
  writeFileSync(path, lines.join("\n"));
  return true;
}
