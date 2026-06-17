export type MicLevelMonitor = { stop: () => void };

// Overvåker om mikrofonen faktisk gir lyd, via Web Audio. Kaller onChange(false)
// når det ikke er registrert signal på `silenceMs` ms, og onChange(true) når lyd
// kommer (tilbake). Fanger «død» mikrofon — f.eks. rutet til en annen enhet via
// Bluetooth, eller dempet — som ellers gir et tomt opptak (0 bytes) og en
// kryptisk «empty audio»-feil fra Azure først HELT på slutten.
//
// En død strøm gir nøyaktig 0 avvik fra stillhet (128), mens en ekte mikrofon
// alltid har et lite støygulv > 0 — så terskelen skiller dem rent.
export function monitorMicLevel(
  stream: MediaStream,
  onChange: (hasSound: boolean) => void,
  silenceMs = 3000
): MicLevelMonitor {
  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  let lastSoundAt = Date.now();
  let reportedSilent = false;
  const interval = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const dev = Math.abs(buf[i] - 128);
      if (dev > peak) peak = dev;
    }
    const now = Date.now();
    if (peak > 2) lastSoundAt = now; // ekte signal; død mikrofon gir peak = 0
    const silent = now - lastSoundAt > silenceMs;
    if (silent !== reportedSilent) {
      reportedSilent = silent;
      onChange(!silent);
    }
  }, 250);

  return {
    stop: () => {
      clearInterval(interval);
      source.disconnect();
      ctx.close().catch(() => {});
    },
  };
}

// Stopper en MediaRecorder og samler chunkene til én Blob — på en måte som
// aldri henger: i tillegg til `onstop` lytter vi på `onerror` og har en
// failsafe-timeout. Tidligere ventet vi kun på `onstop`, som aldri fyrer hvis
// recorderen allerede er stoppet eller feiler — da hang UI-et i «behandler».
export function collectRecording(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob> {
  return new Promise((resolve) => {
    const finalize = () =>
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));

    recorder.onstop = finalize;
    recorder.onerror = finalize;
    // Failsafe: resolve uansett etter 5s (gjentatt resolve er en no-op).
    setTimeout(finalize, 5000);

    if (recorder.state !== "inactive") {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
    } else {
      // Allerede stoppet (f.eks. track avsluttet i bakgrunn) — bruk det vi har.
      finalize();
    }
  });
}
