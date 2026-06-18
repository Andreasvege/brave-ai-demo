import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../.env.local") });
import { dispatchBatch } from "../lib/transcription/batch";
import type { ProviderId } from "../lib/transcription/types";

async function main() {
  const path = "lydopptak/markus_pub_bakgrunnsprating.m4a";
  const buf = readFileSync(path);
  const blob = new Blob([buf], { type: "audio/mp4" });
  for (const id of ["azure-batch", "azure-openai-batch", "aws-batch"] as ProviderId[]) {
    try {
      const r = await dispatchBatch(id, blob, "markus_pub_bakgrunnsprating.m4a");
      console.log(`\n=== ${id} ===\n${r.transcript.slice(0, 200)}`);
    } catch (e) {
      console.log(`\n=== ${id} FEIL ===\n${e instanceof Error ? e.message : e}`);
    }
  }
}
main();
