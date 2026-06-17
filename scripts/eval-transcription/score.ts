// Kvalitetsscoring — kjøres ETTER eval-transcribe, leser eksisterende raw.json
// (re-transkriberer ikke; streaming tar ~5× lydlengden). Gjør to ting:
//   1) WER/CER per provider mot håndskrevet fasit  → <dato>/WER.md
//   2) Nøkkelord-uenighetsmatrise per fil          → <dato>/<slug>/nokkelord.md
// Mangler fasit lages en stub (seedet utkast m/ TODO-markør) som du retter manuelt.
//
//   npm run eval-score                      # nyeste eval-results/<dato>/
//   npm run eval-score eval-results/2026-06-17

import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { FileEvaluation, ProviderReport } from "./types";
import { wer, cer, pct } from "./text";
import { readFasit, ensureFasitStub } from "./fasit";
import { buildKeywordMatrix } from "./keywords";

// Markdown-tabell med justerte kolonner (padder cellene til kolonnebredden).
// æøå og ✓ er enkelttegn i UTF-16, så strenglengde = visuell bredde her.
function mdTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );
  const fmt = (cells: string[]) =>
    "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  const sep = "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";
  return [fmt(headers), sep, ...rows.map(fmt)].join("\n");
}

function latestDateDir(): string | null {
  if (!existsSync("eval-results")) return null;
  const dates = readdirSync("eval-results")
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => statSync(join("eval-results", d)).isDirectory())
    .sort();
  return dates.length ? join("eval-results", dates[dates.length - 1]) : null;
}

function loadEvaluations(dateDir: string): { dir: string; ev: FileEvaluation }[] {
  const out: { dir: string; ev: FileEvaluation }[] = [];
  for (const name of readdirSync(dateDir).sort()) {
    const dir = join(dateDir, name);
    const rawPath = join(dir, "raw.json");
    if (statSync(dir).isDirectory() && existsSync(rawPath)) {
      out.push({ dir, ev: JSON.parse(readFileSync(rawPath, "utf8")) as FileEvaluation });
    }
  }
  return out;
}

// Beste WER per provider: batch hvis den finnes, ellers streaming.
function bestWer(fasit: string, r: ProviderReport): { wer: number | null; cer: number | null } {
  const batch = r.batch && !r.batch.error ? r.batch.transcript : "";
  const stream = r.streaming && !r.streaming.error ? r.streaming.transcript : "";
  const hyp = batch || stream;
  return { wer: wer(fasit, hyp), cer: cer(fasit, hyp) };
}

function writeKeywords(dir: string, ev: FileEvaluation, fasitText?: string): void {
  const { providerNames, rows } = buildKeywordMatrix(ev.reports, fasitText);
  // Fasit?-kolonne: ✓ = ordet står i fasiten (riktig), ✗ = feilhøring, tom hvis ingen fasit.
  const fasitCell = (inFasit?: boolean) => (inFasit == null ? "" : inFasit ? "✓" : "✗");
  const table = mdTable(
    ["Nøkkelord", "Fasit?", ...providerNames],
    rows.map((row) => [
      row.surface,
      fasitCell(row.inFasit),
      ...row.present.map((p) => (p ? "✓" : "·")),
    ])
  );

  const md = `# Nøkkelord-uenighet — ${basename(ev.audioFile)}

Kandidat-egennavn og tall fra transkriptene. **Uenighet øverst** (færrest ✓ =
providerne spriker = mest interessant). I provider-kolonnene: ✓ = produserte ordet,
· = ikke. **Fasit?**: ✓ = ordet står i fasiten (riktig variant), ✗ = feilhøring.
Les radene slik: en provider med ✓ på en ✗-rad bommet; ✗ på en ✓-rad = den mistet
ordet. Fanger egennavn-kvalitet som WER ikke vekter.

${table}
`;
  writeFileSync(join(dir, "nokkelord.md"), md);
}

function main() {
  const arg = process.argv[2];
  const dateDir = arg ?? latestDateDir();
  if (!dateDir || !existsSync(dateDir)) {
    console.error("Fant ingen eval-results/<dato>/. Kjør eval-transcribe først, eller oppgi mappe.");
    process.exit(1);
  }

  const evals = loadEvaluations(dateDir);
  if (evals.length === 0) {
    console.error(`Ingen raw.json funnet i ${dateDir}.`);
    process.exit(1);
  }
  console.log(`Scorer ${evals.length} fil(er) i ${dateDir}\n`);

  const providerNames = evals[0].ev.reports.map((r) => r.name);
  const created: string[] = [];
  const pending: string[] = [];

  // WER-rader (én per fil), batch-eller-streaming WER per provider.
  const werRows: string[][] = [];

  for (const { dir, ev } of evals) {
    if (ensureFasitStub(dir, basename(ev.audioFile), ev.reports)) {
      created.push(basename(ev.audioFile));
    }

    const fasit = readFasit(dir);
    const label = basename(ev.audioFile);

    // Nøkkelord-matrise: auto-fyll Fasit?-kolonnen når fasiten er klar.
    writeKeywords(dir, ev, fasit.state === "ready" ? fasit.text : undefined);

    if (fasit.state !== "ready") {
      if (fasit.state === "todo") pending.push(label);
      werRows.push([label, ...providerNames.map(() => "—")]);
      continue;
    }
    const cells = providerNames.map((name) => {
      const r = ev.reports.find((x) => x.name === name);
      if (!r) return "—";
      const { wer: w, cer: c } = bestWer(fasit.text, r);
      return w == null ? "—" : `${pct(w)} / ${pct(c)}`;
    });
    werRows.push([label, ...cells]);
  }

  const werTable = mdTable(["Fil", ...providerNames], werRows);
  const md = `# Kvalitetsscoring (WER / CER) — ${basename(dateDir)}

Lavere = bedre. Format: **WER / CER** mot håndskrevet fasit (\`<slug>/fasit.txt\`).
Bruker batch-transkript der det finnes, ellers streaming. Filer uten ferdig fasit
viser «—». WER straffer alle ordfeil likt og fanger ikke egennavn-vekting — se
\`<slug>/nokkelord.md\` for det.

${werTable}

## Status fasit
- Ferdige: ${evals.length - pending.length} / ${evals.length}
${created.length ? `- Nye stubs opprettet (rett dem): ${created.join(", ")}` : ""}
${pending.length ? `- Venter på retting (TODO-markør står igjen): ${pending.join(", ")}` : ""}
`;

  const outPath = join(dateDir, "WER.md");
  writeFileSync(outPath, md);
  console.log(`WER-rapport: ${outPath}`);
  console.log(`Nøkkelord-matriser: ${dateDir}/<slug>/nokkelord.md`);
  if (created.length) console.log(`\nNye fasit-stubs (rett dem, fjern # TODO):\n  ${created.join("\n  ")}`);
  if (pending.length) console.log(`\nVenter på fasit-retting:\n  ${pending.join("\n  ")}`);
}

main();
