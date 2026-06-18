"use client";

import { useEffect, useRef, useState } from "react";
import { submitRecordedBlob } from "@/lib/upload-audio";
import { collectRecording, monitorMicLevel, type MicLevelMonitor } from "@/lib/recording";

type Phase = "idle" | "connecting" | "recording" | "processing" | "error";

export function PipRecordContent({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [noAudio, setNoAudio] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const micMonitor = useRef<MicLevelMonitor | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      micMonitor.current?.stop();
      const rec = mediaRecorder.current;
      if (rec && rec.state !== "inactive") {
        // PiP-vinduet lukkes midt i opptak: ikke forkast opptaket. Opptaker og
        // fetch lever på hovedvinduet og overlever at PiP-vinduet rives ned, så
        // vi finaliserer og laster opp i bakgrunnen (best effort).
        const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
        mediaRecorder.current = null;
        collectRecording(rec, audioChunks.current)
          .then((blob) => submitRecordedBlob(blob, { durationSec }))
          .catch((e) => console.error("PiP-nedriving: lagring av opptak feilet", e));
      } else {
        rec?.stream?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startRecording() {
    setError(null);
    setPhase("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const recorder = new MediaRecorder(stream);
      audioChunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      recorder.start(500);
      mediaRecorder.current = recorder;
      setNoAudio(false);
      try {
        micMonitor.current = monitorMicLevel(stream, (hasSound) => setNoAudio(!hasSound));
      } catch {
        micMonitor.current = null;
      }
      startedAt.current = Date.now();
      setSeconds(0);
      timer.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
        1000
      );
      setPhase("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mikrofontilgang nektet");
      setPhase("error");
    }
  }

  async function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    const recorder = mediaRecorder.current;
    if (!recorder) return;

    micMonitor.current?.stop();
    micMonitor.current = null;
    setNoAudio(false);
    const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
    const blob = await collectRecording(recorder, audioChunks.current);
    mediaRecorder.current = null;
    setPhase("processing");

    try {
      await submitRecordedBlob(blob, { durationSec });
      // Hold PiP-vinduet oppe: nullstill til idle så det er klart for nytt
      // opptak, i stedet for å lukke vinduet.
      setSeconds(0);
      setError(null);
      setPhase("idle");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
      setPhase("error");
    }
  }

  function abortRecording() {
    if (timer.current) clearInterval(timer.current);
    const recorder = mediaRecorder.current;
    if (recorder) {
      recorder.stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
      mediaRecorder.current = null;
    }
    micMonitor.current?.stop();
    micMonitor.current = null;
    audioChunks.current = [];
    setNoAudio(false);
    setSeconds(0);
    setError(null);
    setPhase("idle");
  }

  function cancel() {
    abortRecording();
    onClose();
  }

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  const isRecording = phase === "recording";
  const isBusy = phase === "connecting" || phase === "processing";

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes pip-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(58,92,40,0.35); }
          50%       { box-shadow: 0 0 0 8px rgba(58,92,40,0); }
        }
      `}</style>

      {/* Record / Stop */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isBusy}
        title={isRecording ? "Stopp opptak" : "Start opptak"}
        style={{
          ...styles.recordBtn,
          backgroundColor: isRecording ? "#3a5c28" : "#f3f4f6",
          color: isRecording ? "#fff" : "#374151",
          animation: isRecording ? "pip-pulse 1.6s ease-out infinite" : "none",
          opacity: isBusy ? 0.5 : 1,
          cursor: isBusy ? "default" : "pointer",
        }}
      >
        {isBusy ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        ) : isRecording ? (
          <span style={styles.stopSquare} />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
          </svg>
        )}
      </button>

      {/* Timer + hint */}
      <div style={styles.center}>
        <p style={styles.timer}>{mm}:{ss}</p>
        {error && <p style={styles.error}>Feil — prøv igjen</p>}
        {!error && (phase === "connecting" || phase === "processing") && (
          <p style={styles.hint}>
            {phase === "connecting" ? "Kobler til…" : "Behandler…"}
          </p>
        )}
        {!error && isRecording &&
          (noAudio ? (
            <p style={styles.warn} title="Sjekk mikrofonen — koblet til Bluetooth?">
              ⚠️ Ingen lyd
            </p>
          ) : (
            <p style={styles.hint}>Tar opp</p>
          ))}
      </div>

      {/* Avbryt — alltid synlig, grået ut når ikke aktiv */}
      <button
        onClick={isRecording ? abortRecording : undefined}
        disabled={!isRecording}
        title={isRecording ? "Avbryt opptak" : ""}
        style={{ ...styles.abortBtn, color: isRecording ? "#dc2626" : "#d1d5db", cursor: isRecording ? "pointer" : "default" }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        </svg>
      </button>

      {/* X — lukker vinduet */}
      <button onClick={cancel} title="Lukk" style={styles.closeBtn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: "100%",
    padding: "0 16px",
    gap: "12px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    backgroundColor: "#ffffff",
    boxSizing: "border-box",
  },
  recordBtn: {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "1.5px solid #d1d5db",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background-color 0.2s",
  },
  stopSquare: {
    display: "block",
    width: "14px",
    height: "14px",
    backgroundColor: "#ffffff",
    borderRadius: "3px",
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
  },
  timer: {
    margin: 0,
    fontFamily: "ui-monospace, monospace",
    fontSize: "22px",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    color: "#111827",
    lineHeight: 1,
  },
  hint: {
    margin: 0,
    fontSize: "11px",
    color: "#9ca3af",
    letterSpacing: "0.02em",
  },
  error: {
    margin: 0,
    fontSize: "11px",
    color: "#dc2626",
  },
  warn: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 600,
    color: "#b45309",
  },
  abortBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#dc2626",
    padding: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    flexShrink: 0,
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#9ca3af",
    padding: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    flexShrink: 0,
  },
};
