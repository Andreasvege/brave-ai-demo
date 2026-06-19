import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // 16-bit
const CHANNELS = 1;

// Konverter vilkårlig lydfil til WAV (16-bit/mono) ved gitt sample rate. Standard
// 16 kHz (Azure/AWS); OpenAI Realtime krever 24 kHz. Returnerer sti til WAV.
export function toWav(inputPath: string, sampleRate: number = SAMPLE_RATE): string {
  if (!ffmpegPath) throw new Error("ffmpeg-static fant ingen binærfil");
  const outDir = mkdtempSync(join(tmpdir(), "eval-wav-"));
  const outPath = join(outDir, "audio.wav");
  const res = spawnSync(
    ffmpegPath,
    [
      "-i", inputPath,
      "-ar", String(sampleRate),
      "-ac", String(CHANNELS),
      "-sample_fmt", "s16",
      "-y", outPath,
    ],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg feilet: ${res.stderr?.slice(0, 500)}`);
  }
  return outPath;
}

// Les WAV-varighet i sekunder fra rå PCM-data (hopper over 44-byte header).
export function wavDurationSec(wavPath: string, sampleRate: number = SAMPLE_RATE): number {
  const buf = readFileSync(wavPath);
  const pcmBytes = buf.length - 44;
  return pcmBytes / (sampleRate * BYTES_PER_SAMPLE * CHANNELS);
}

// Del WAV-PCM (uten header) i biter på ~chunkMs millisekunder. sampleRate MÅ matche
// WAV-fila — ellers blir sanntidsmatingen feil tempo.
export function chunkPcm(
  wavPath: string,
  chunkMs = 100,
  sampleRate: number = SAMPLE_RATE
): Buffer[] {
  const buf = readFileSync(wavPath);
  const pcm = buf.subarray(44); // hopp over standard WAV-header
  const bytesPerChunk =
    Math.floor((sampleRate * chunkMs) / 1000) * BYTES_PER_SAMPLE * CHANNELS;
  const chunks: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += bytesPerChunk) {
    chunks.push(pcm.subarray(i, Math.min(i + bytesPerChunk, pcm.length)));
  }
  return chunks;
}

export const AUDIO_FORMAT = { SAMPLE_RATE, BYTES_PER_SAMPLE, CHANNELS };
