import { writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { FileEvaluation } from "./types";

function ms(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toLocaleString("no-NO");
}

function usd(v: number): string {
  return `$${v.toFixed(4)}`;
}

// Filnavn (uten extension) → trygt mappenavn. Kvalitet ligger i filnavnet, så
// "daarlig_stoy.webm" → "daarlig_stoy" og vises som sådan i rapportene.
function slugFor(audioFile: string): string {
  return basename(audioFile, extname(audioFile)).replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function dateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Skriver én detaljrapport (metrikk + fulle transkripter) per lydfil i egen
// undermappe: eval-results/<dato>/<filnavn>/report.md (+ raw.json).
export function writeReport(ev: FileEvaluation): string {
  const { audioFile, durationSec, reports } = ev;
  const outDir = join("eval-results", dateStr(), slugFor(audioFile));
  mkdirSync(outDir, { recursive: true });

  const rows = reports
    .map(
      (r) =>
        `| ${r.name} | ${ms(r.batch?.durationMs)} | ${ms(
          r.streaming?.timeToFirstWordMs
        )} | ${usd(r.costPerMinuteUSD)} |`
    )
    .join("\n");

  const batchTranscripts = reports
    .map(
      (r) =>
        `### ${r.name}\n${
          r.batch?.error
            ? `_Feil: ${r.batch.error}_`
            : `> ${r.batch?.transcript || "_(ingen batch-støtte)_"}`
        }`
    )
    .join("\n\n");

  const streamTranscripts = reports
    .map(
      (r) =>
        `### ${r.name}\n${
          r.streaming?.error
            ? `_Feil: ${r.streaming.error}_`
            : `> ${r.streaming?.transcript || "_(ingen streaming-støtte)_"}`
        }`
    )
    .join("\n\n");

  const min = durationSec / 60;
  const costRows = reports
    .map(
      (r) =>
        `| ${r.name} | ${usd(r.costPerMinuteUSD * min)} | $${(
          r.costPerMinuteUSD *
          5 *
          200
        ).toFixed(2)} |`
    )
    .join("\n");

  const md = `# Transkripsjonsevaluering — ${dateStr()}
Lydfil: ${audioFile} (${Math.floor(durationSec / 60)} min ${Math.round(
    durationSec % 60
  )} sek)

## Metrikk-oversikt
| Provider | Batch (ms) | Streaming TTF (ms) | Kost/min (USD) |
|---|---|---|---|
${rows}

## Transkripter (batch)
${batchTranscripts}

## Transkripter (streaming)
${streamTranscripts}

## Prisberegning
| Provider | Denne filen | 200 samtaler/mnd à 5 min |
|---|---|---|
${costRows}
`;

  const mdPath = join(outDir, "report.md");
  writeFileSync(mdPath, md);
  writeFileSync(
    join(outDir, "raw.json"),
    JSON.stringify({ audioFile, durationSec, reports }, null, 2)
  );
  return mdPath;
}

// Snitt over filene der provideren faktisk leverte et resultat (ikke feil/tomt).
function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => v != null && v > 0);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Samlerapport på tvers av alle filer: aggregert metrikk per provider +
// per-fil-oversikt med lenker + tom kvalitetsmatrise for manuell skåring.
export function writeSummary(evals: FileEvaluation[]): string {
  const outDir = join("eval-results", dateStr());
  mkdirSync(outDir, { recursive: true });

  // Bevar provider-rekkefølgen fra første fil.
  const providerNames = evals[0]?.reports.map((r) => r.name) ?? [];

  const get = (ev: FileEvaluation, name: string) =>
    ev.reports.find((r) => r.name === name);

  // Aggregert metrikk per provider.
  const aggRows = providerNames
    .map((name) => {
      const cells = evals.map((ev) => get(ev, name));
      const cost = cells.find((c) => c)?.costPerMinuteUSD ?? 0;
      const avgBatch = avg(
        cells.map((c) => (c?.batch?.error ? null : c?.batch?.durationMs))
      );
      const avgTtf = avg(
        cells.map((c) =>
          c?.streaming?.error ? null : c?.streaming?.timeToFirstWordMs
        )
      );
      const fails = cells.filter(
        (c) => c?.batch?.error || c?.streaming?.error
      ).length;
      return `| ${name} | ${ms(avgBatch)} | ${ms(avgTtf)} | ${usd(cost)} | $${(
        cost *
        5 *
        200
      ).toFixed(2)} | ${fails}/${evals.length} |`;
    })
    .join("\n");

  // Per-fil-oversikt: én rad per fil, lenke til detaljrapport.
  const fileRows = evals
    .map((ev) => {
      const slug = slugFor(ev.audioFile);
      const dur = `${Math.floor(ev.durationSec / 60)}:${String(
        Math.round(ev.durationSec % 60)
      ).padStart(2, "0")}`;
      return `| [${basename(ev.audioFile)}](${slug}/report.md) | ${dur} |`;
    })
    .join("\n");

  // Kvalitetsmatrise: tom mal for manuell skåring (1–5) per fil × provider.
  const header = `| Fil | ${providerNames.join(" | ")} |`;
  const sep = `|---|${providerNames.map(() => "---").join("|")}|`;
  const qualityRows = evals
    .map(
      (ev) =>
        `| ${basename(ev.audioFile)} | ${providerNames
          .map(() => " ")
          .join(" | ")} |`
    )
    .join("\n");

  const md = `# Transkripsjonsevaluering — SAMMENDRAG (${dateStr()})
Filer testet: ${evals.length}

## Aggregert metrikk per provider
Snitt over filene der provideren faktisk leverte resultat. «Feil» = filer med batch- eller streaming-feil.
| Provider | Snitt batch (ms) | Snitt TTF (ms) | Kost/min | 200 kall/mnd | Feil |
|---|---|---|---|---|---|
${aggRows}

## Filer
| Fil | Lengde |
|---|---|
${fileRows}

## Kvalitetsmatrise (fyll inn manuelt: 1–5)
Les hver detaljrapport og skår norsk kvalitet (egennavn, fagord, mening bevart).
${header}
${sep}
${qualityRows}
`;

  const mdPath = join(outDir, "SAMMENDRAG.md");
  writeFileSync(mdPath, md);
  return mdPath;
}
