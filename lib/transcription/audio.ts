import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const SAMPLE_RATE = 16000;

// Convert an arbitrary audio Blob to headerless 16 kHz/mono/s16 PCM.
export async function blobToPcm(audio: Blob): Promise<{ pcm: Buffer; sampleRate: number }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static fant ingen binærfil");
  const dir = mkdtempSync(join(tmpdir(), "stt-"));
  const inPath = join(dir, "in");
  const outPath = join(dir, "out.wav");
  writeFileSync(inPath, Buffer.from(await audio.arrayBuffer()));
  const res = spawnSync(
    ffmpegPath,
    ["-i", inPath, "-ar", String(SAMPLE_RATE), "-ac", "1", "-sample_fmt", "s16", "-y", outPath],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(`ffmpeg feilet: ${res.stderr?.slice(0, 500)}`);
  const wav = readFileSync(outPath);
  return { pcm: wav.subarray(44), sampleRate: SAMPLE_RATE }; // drop 44-byte WAV header
}

export function chunkBuffer(buf: Buffer, chunkBytes = 16000 * 2 / 10): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunkBytes) {
    chunks.push(buf.subarray(i, Math.min(i + chunkBytes, buf.length)));
  }
  return chunks;
}
