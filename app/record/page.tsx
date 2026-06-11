"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "recording" | "processing" | "done" | "error";
type PipelineStep = "TRANSCRIBING" | "ANALYZING" | "DONE";

export default function RecordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<PipelineStep>("TRANSCRIBING");
  const [seconds, setSeconds] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (poller.current) clearInterval(poller.current);
      mediaRecorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setError(null);
    try {
      // KUN mikrofon — aldri getDisplayMedia/systemlyd (GDPR)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/mp4";
      chunks.current = [];
      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32_000,
      });
      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
      mediaRecorder.current.start(1000);
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setPhase("recording");
    } catch {
      setError("Fikk ikke tilgang til mikrofonen. Sjekk tillatelser i nettleseren.");
      setPhase("error");
    }
  }

  function stopRecording() {
    const rec = mediaRecorder.current;
    if (!rec) return;
    if (timer.current) clearInterval(timer.current);
    rec.onstop = () => {
      const type = rec.mimeType.includes("mp4") ? "audio/mp4" : "audio/webm";
      const blob = new Blob(chunks.current, { type });
      rec.stream.getTracks().forEach((t) => t.stop());
      const ext = type === "audio/mp4" ? "m4a" : "webm";
      submit(blob, `opptak.${ext}`, seconds);
    };
    rec.stop();
  }

  async function submit(audio: Blob, filename: string, durationSec: number | null) {
    setPhase("processing");
    setStep("TRANSCRIBING");
    const startedAt = Date.now();

    // POST-en kjører hele pipelinen synkront; poll lista for ekte status underveis.
    poller.current = setInterval(async () => {
      try {
        const res = await fetch("/api/calls");
        const calls: { createdAt: string; status: string }[] = await res.json();
        const current = calls.find(
          (c) => new Date(c.createdAt).getTime() >= startedAt - 5000
        );
        if (current?.status === "ANALYZING") setStep("ANALYZING");
      } catch {
        // statuspolling er kun kosmetisk
      }
    }, 1500);

    try {
      const formData = new FormData();
      formData.append("audio", audio, filename);
      formData.append("notes", notes);
      if (durationSec) formData.append("durationSec", String(durationSec));

      const res = await fetch("/api/calls", { method: "POST", body: formData });
      const data = await res.json();
      if (poller.current) clearInterval(poller.current);

      if (!res.ok) throw new Error(data.error || `Feil ${res.status}`);

      setStep("DONE");
      setPhase("done");
      setTimeout(() => router.push(`/calls/${data.id}`), 900);
    } catch (err) {
      if (poller.current) clearInterval(poller.current);
      setError(err instanceof Error ? err.message : "Noe gikk galt");
      setPhase("error");
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) submit(file, file.name, null);
    e.target.value = "";
  }

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="fade-up mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nytt opptak</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Kun din mikrofon tas opp — motparten havner aldri i opptaket.
      </p>

      <div className="card mt-8 flex flex-col items-center px-8 py-12">
        {phase === "processing" || phase === "done" ? (
          <PipelineStatus step={step} />
        ) : (
          <>
            <button
              onClick={phase === "recording" ? stopRecording : startRecording}
              aria-label={phase === "recording" ? "Stopp opptak" : "Start opptak"}
              className={`flex h-24 w-24 items-center justify-center rounded-full transition-all ${
                phase === "recording"
                  ? "rec-pulse bg-accent text-white"
                  : "border border-border-strong bg-surface text-ink hover:border-accent-ink hover:text-accent-ink"
              }`}
            >
              {phase === "recording" ? (
                <span className="block h-7 w-7 rounded-[5px] bg-white" />
              ) : (
                <MicIcon />
              )}
            </button>

            <p className="mt-5 font-mono text-3xl tabular-nums tracking-tight">
              {mm}:{ss}
            </p>
            <p className="mt-1 text-sm text-ink-faint">
              {phase === "recording" ? "Tar opp… klikk for å stoppe" : "Klikk for å starte opptak"}
            </p>

            {error && (
              <p className="mt-4 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="mt-8 w-full">
              <label className="kicker" htmlFor="notes">
                Notater under samtalen
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder="Skriv hva motparten sier mens du prater — navn, firma, innvendinger, avtaler. Notatene gir AI-en motpartens side."
                className="mt-2 w-full resize-y rounded-xl border border-border bg-bg px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-ink-faint focus:border-accent-ink focus:bg-surface"
              />
            </div>

            {phase !== "recording" && (
              <div className="mt-6 w-full border-t border-border pt-5 text-center">
                <label className="cursor-pointer text-sm text-ink-soft underline decoration-border-strong underline-offset-4 transition-colors hover:text-accent-ink">
                  …eller last opp en lydfil (m4a, webm, wav, mp3)
                  <input
                    type="file"
                    accept=".m4a,.webm,.wav,.mp3,audio/*"
                    className="hidden"
                    onChange={onFileSelected}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PipelineStatus({ step }: { step: PipelineStep }) {
  const steps: { key: PipelineStep; label: string }[] = [
    { key: "TRANSCRIBING", label: "Transkriberer" },
    { key: "ANALYZING", label: "Analyserer" },
    { key: "DONE", label: "Ferdig" },
  ];
  const idx = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex w-full max-w-xs flex-col gap-4 py-6" aria-live="polite">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          {i < idx ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-soft text-green-ink">
              <CheckIcon />
            </span>
          ) : i === idx && s.key !== "DONE" ? (
            <span className="spinner" />
          ) : i === idx ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-soft text-green-ink">
              <CheckIcon />
            </span>
          ) : (
            <span className="h-5 w-5 rounded-full border border-border" />
          )}
          <span
            className={`text-sm ${
              i <= idx ? "font-medium text-ink" : "text-ink-faint"
            }`}
          >
            {s.label}
            {i === idx && s.key !== "DONE" ? "…" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
