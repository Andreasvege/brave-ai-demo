"use client";

// Fanger mikrofonlyd som PCM16 ved en mål-samplerate og leverer hver bit som base64.
// Brukes av live-leverandører som streamer rå PCM over WebSocket (Azure OpenAI Realtime;
// senere AWS streaming). ScriptProcessorNode er deprecated, men er enklest på tvers av
// nettlesere og holder rikelig for demoen. Gain settes til 0 så mikrofonen ikke spilles
// tilbake i høyttaleren (unngår feedback).

export type AudioCapture = { stop: () => void };

// Leverer hver bit som rå PCM16 LE-bytes. AWS streaming tar disse direkte; Azure OpenAI
// base64-koder dem først (se bytesToBase64).
export async function startPcmCapture(
  targetRate: number,
  onChunk: (pcm16: Uint8Array) => void
): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const down = downsample(input, ctx.sampleRate, targetRate);
    const pcm16 = floatToPcm16(down);
    onChunk(new Uint8Array(pcm16.buffer));
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  return {
    stop() {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
    },
  };
}

// Naiv nedsampling (nærmeste nabo). God nok for tale; ikke hi-fi.
function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
