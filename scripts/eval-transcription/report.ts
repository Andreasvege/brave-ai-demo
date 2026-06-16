import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProviderReport } from "./types";

function ms(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toLocaleString("no-NO");
}

export function writeReport(
  reports: ProviderReport[],
  audioFile: string,
  durationSec: number
): string {
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join("eval-results", date);
  mkdirSync(outDir, { recursive: true });

  const rows = reports
    .map(
      (r) =>
        `| ${r.name} | ${ms(r.batch?.durationMs)} | ${ms(
          r.streaming?.timeToFirstWordMs
        )} | $${r.costPerMinuteUSD.toFixed(4)} |`
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
        `| ${r.name} | $${(r.costPerMinuteUSD * min).toFixed(4)} | $${(
          r.costPerMinuteUSD *
          5 *
          200
        ).toFixed(2)} |`
    )
    .join("\n");

  const md = `# Transkripsjonsevaluering — ${date}
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
