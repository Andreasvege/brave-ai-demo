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
