"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MicIcon, CheckIcon } from "@/components/icons";
import { uploadAudio } from "@/lib/upload-audio";
import { collectRecording, monitorMicLevel, type MicLevelMonitor } from "@/lib/recording";
import { ModelSelect } from "@/components/model-select";
import { getDefaultProvider, setDefaultProvider } from "@/lib/transcription/client";
import type { ProviderId } from "@/lib/transcription/types";
import { createLiveTranscriber } from "@/lib/transcription/live";
import type { LiveTranscriber } from "@/lib/transcription/types";

type TranscribeMode = "live" | "batch";
type Phase = "idle" | "connecting" | "recording" | "processing" | "done" | "error";

type Step = { key: string; label: string };
const LIVE_STEPS: Step[] = [
  { key: "ANALYZING", label: "Analyserer" },
  { key: "DONE", label: "Ferdig" },
];
const BATCH_STEPS: Step[] = [
  { key: "UPLOADING", label: "Laster opp" },
  { key: "TRANSCRIBING", label: "Transkriberer" },
  { key: "ANALYZING", label: "Analyserer" },
  { key: "DONE", label: "Ferdig" },
];

export default function RecordPage() {
  const router = useRouter();
  const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>("batch");
  const [provider, setProvider] = useState<ProviderId>(() => getDefaultProvider("batch"));

  function chooseProvider(id: ProviderId) {
    setProvider(id);
    setDefaultProvider(transcribeMode, id);
  }

  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>(LIVE_STEPS);
  const [stepKey, setStepKey] = useState("ANALYZING");
  const [seconds, setSeconds] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Varsel når mikrofonen ikke gir lyd (f.eks. Bluetooth-rutet til en annen enhet).
  const [noAudio, setNoAudio] = useState(false);

  // Live-transkripsjon
  const [phrases, setPhrases] = useState<string[]>([]);
  const [interim, setInterim] = useState("");
  const phrasesRef = useRef<string[]>([]);
  const interimRef = useRef("");
  const live = useRef<LiveTranscriber | null>(null);

  // Batch-opptak
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const micMonitor = useRef<MicLevelMonitor | null>(null);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptBox = useRef<HTMLDivElement | null>(null);
  // Tidsstempel for opptaksstart — gir riktig varighet selv om fanen er i
  // bakgrunnen (der setInterval strupes til ~1/min).
  const startedAt = useRef(0);
  // Beholder siste opptak i minnet så «Prøv igjen» kan sende på nytt uten nytt opptak.
  const lastFile = useRef<{ file: File; durationSec?: number; mode: "batch" | "file" } | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (poller.current) clearInterval(poller.current);
      live.current?.stop();
      mediaRecorder.current?.stop();
      micMonitor.current?.stop();
    };
  }, []);

  useEffect(() => {
    const box = transcriptBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [phrases, interim]);

  async function startRecording() {
    setError(null);
    setPhase("connecting");
    try {
      if (transcribeMode === "live") {
        await startLive();
      } else {
        await startBatch();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Fikk ikke startet opptak. Sjekk mikrofontilgang i nettleseren."
      );
      setPhase("error");
    }
  }

  async function startLive() {
    const t = createLiveTranscriber(provider);
    t.onPartial = (text) => { interimRef.current = text; setInterim(text); };
    t.onFinal = (text) => {
      phrasesRef.current = [...phrasesRef.current, text];
      setPhrases(phrasesRef.current);
      interimRef.current = "";
      setInterim("");
    };
    t.onError = (err) => { setError(`Transkribering avbrutt: ${err.message}`); setPhase("error"); };

    phrasesRef.current = [];
    interimRef.current = "";
    setPhrases([]);
    setInterim("");
    await t.start();
    live.current = t;

    startedAt.current = Date.now();
    setSeconds(0);
    timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    setPhase("recording");
  }

  async function startBatch() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const recorder = new MediaRecorder(stream);
    audioChunks.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.current.push(e.data);
    };

    recorder.start(500);
    mediaRecorder.current = recorder;
    // Overvåk faktisk mikrofonnivå — varsle hvis ingen lyd kommer inn.
    // Best effort: en feil i målingen skal aldri hindre selve opptaket.
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
  }

  async function stopRecording() {
    if (timer.current) clearInterval(timer.current);

    if (transcribeMode === "live") {
      await stopLive();
    } else {
      await stopBatch();
    }
  }

  async function stopLive() {
    const t = live.current;
    if (!t) return;
    const { transcript } = await t.stop();
    live.current = null;
    const cleaned = transcript.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      setError("Ingen tale ble gjenkjent — transkriptet er tomt.");
      setPhase("error");
      return;
    }
    await submitLive(cleaned, Math.round((Date.now() - startedAt.current) / 1000));
  }

  async function stopBatch() {
    const recorder = mediaRecorder.current;
    if (!recorder) return;

    micMonitor.current?.stop();
    micMonitor.current = null;
    setNoAudio(false);
    const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
    const blob = await collectRecording(recorder, audioChunks.current);
    mediaRecorder.current = null;
    const file = new File([blob], "opptak.webm", { type: blob.type });
    await submitFile(file, durationSec, "batch");
  }

  async function abortRecording() {
    if (timer.current) clearInterval(timer.current);

    if (transcribeMode === "live") {
      if (live.current) { await live.current.stop(); live.current = null; }
      phrasesRef.current = [];
      interimRef.current = "";
      setPhrases([]);
      setInterim("");
    } else {
      const recorder = mediaRecorder.current;
      if (recorder) {
        recorder.stream.getTracks().forEach((t) => t.stop());
        recorder.stop();
        mediaRecorder.current = null;
      }
      micMonitor.current?.stop();
      micMonitor.current = null;
      setNoAudio(false);
      audioChunks.current = [];
    }

    setSeconds(0);
    setPhase("idle");
  }

  async function submitLive(transcript: string, durationSec: number) {
    setPhase("processing");
    setSteps(LIVE_STEPS);
    setStepKey("ANALYZING");
    try {
      const formData = new FormData();
      formData.append("transcript", transcript);
      formData.append("transcribeMode", "live");
      formData.append("transcribeProvider", provider);
      formData.append("notes", notes);
      if (durationSec) formData.append("durationSec", String(durationSec));
      await postAndNavigate(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
      setPhase("error");
    }
  }

  async function submitFile(file: File, durationSec?: number, mode: "batch" | "file" = "batch") {
    lastFile.current = { file, durationSec, mode };
    setError(null);
    setPhase("processing");
    setSteps(BATCH_STEPS);
    setStepKey("UPLOADING");

    try {
      // 1) Last lyden direkte opp til Vercel Blob — utenom request-body, så
      //    Vercels ~4,5 MB body-grense rammer ikke lange opptak.
      const audioUrl = await uploadAudio(file);

      // 2) Start pipelinen med blob-URL-en, og poll for statusvisning.
      setStepKey("TRANSCRIBING");
      const startedAt = Date.now();
      poller.current = setInterval(async () => {
        try {
          const res = await fetch("/api/calls");
          const calls: { createdAt: string; status: string }[] = await res.json();
          const current = calls.find(
            (c) => new Date(c.createdAt).getTime() >= startedAt - 5000
          );
          if (current?.status === "ANALYZING") setStepKey("ANALYZING");
        } catch {
          // statuspolling er kun kosmetisk
        }
      }, 1500);

      const formData = new FormData();
      formData.append("audioUrl", audioUrl);
      formData.append("transcribeMode", mode);
      formData.append("transcribeProvider", provider);
      formData.append("notes", notes);
      if (durationSec) formData.append("durationSec", String(durationSec));
      await postAndNavigate(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
      setPhase("error");
    } finally {
      if (poller.current) clearInterval(poller.current);
    }
  }

  function retrySubmit() {
    const last = lastFile.current;
    if (last) submitFile(last.file, last.durationSec, last.mode);
  }

  async function postAndNavigate(formData: FormData) {
    const res = await fetch("/api/calls", { method: "POST", body: formData });
    const data = await res.json();
    if (poller.current) clearInterval(poller.current);
    if (!res.ok) throw new Error(data.error || `Feil ${res.status}`);
    setStepKey("DONE");
    setPhase("done");
    setTimeout(() => router.push(`/calls/${data.id}`), 900);
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) submitFile(file, undefined, "file");
    e.target.value = "";
  }

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  const isRecording = phase === "recording";
  const isBusy = phase === "processing" || phase === "done";

  return (
    <div className="fade-up mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nytt opptak - Lykke til King 👑</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Kun din mikrofon tas opp — motparten havner aldri i opptaket.
      </p>

      <Card className="mt-8 flex flex-col items-center px-8 py-10">
        {isBusy ? (
          <PipelineStatus steps={steps} stepKey={stepKey} />
        ) : (
          <>
            {/* Transkripsjonsmodus-toggle */}
            <div
              role="group"
              aria-label="Transkripsjonsmodus"
              className="flex w-full max-w-xs rounded-xl border border-border bg-bg p-1"
            >
              {(["batch", "live"] as TranscribeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { if (!isRecording) { setTranscribeMode(m); setProvider(getDefaultProvider(m)); } }}
                  aria-pressed={transcribeMode === m}
                  disabled={isRecording}
                  className={`flex-1 rounded-[9px] py-1.5 text-sm font-medium transition-all disabled:opacity-40 ${
                    transcribeMode === m
                      ? "bg-surface text-ink shadow-sm ring-1 ring-border"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {m === "live" ? "Live-transkripsjon" : "Batch-transkripsjon"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              {transcribeMode === "live"
                ? "Transkriberes underveis — du ser teksten mens du snakker"
                : "Transkriberes etter opptaket — høyere nøyaktighet"}
            </p>

            <ModelSelect
              mode={transcribeMode}
              value={provider}
              onChange={chooseProvider}
              disabled={isRecording || phase === "connecting"}
            />

            {/* Mikrofonknapp */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={phase === "connecting"}
              aria-label={isRecording ? "Stopp opptak" : "Start opptak"}
              className={`mt-8 flex h-24 w-24 items-center justify-center rounded-full transition-all disabled:opacity-60 ${
                isRecording
                  ? "rec-pulse bg-accent text-white"
                  : "border border-border-strong bg-surface text-ink hover:border-accent-ink hover:text-accent-ink"
              }`}
            >
              {phase === "connecting" ? (
                <Spinner className="text-xl" />
              ) : isRecording ? (
                <span className="block h-7 w-7 rounded-[5px] bg-white" />
              ) : (
                <MicIcon width={30} height={30} strokeWidth="1.6" />
              )}
            </button>

            {isRecording && (
              <Button
                variant="dangerGhost"
                size="sm"
                className="mt-3"
                onClick={abortRecording}
              >
                Avbryt opptak
              </Button>
            )}

            <p className="mt-5 font-mono text-3xl tabular-nums tracking-tight">
              {mm}:{ss}
            </p>
            <p className="mt-1 text-sm text-ink-faint">
              {phase === "connecting"
                ? "Kobler til…"
                : isRecording
                  ? transcribeMode === "live"
                    ? "Tar opp og transkriberer live — klikk for å stoppe"
                    : "Tar opp — transkriberes når du stopper"
                  : "Klikk for å starte opptak"}
            </p>

            {isRecording && noAudio && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-soft px-4 py-2 text-sm text-amber-ink">
                <span aria-hidden>⚠️</span>
                <span>
                  Ingen lyd oppdaget. Sjekk at riktig mikrofon er valgt — er den
                  koblet til en annen enhet via Bluetooth, fanger den ikke opp tale.
                </span>
              </p>
            )}

            {error && (
              <p className="mt-4 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            {phase === "error" && lastFile.current && (
              <Button size="sm" className="mt-3" onClick={retrySubmit}>
                Prøv å sende igjen
              </Button>
            )}

            {/* Live-transkriptpanel */}
            {transcribeMode === "live" && (isRecording || phrases.length > 0) && (
              <div className="mt-6 w-full">
                <div className="flex items-center justify-between">
                  <span className="kicker">Live-transkript</span>
                  {isRecording && (
                    <span className="flex items-center gap-1.5 text-xs text-accent-ink">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                      direkte
                    </span>
                  )}
                </div>
                <div
                  ref={transcriptBox}
                  className="mt-2 max-h-48 w-full overflow-y-auto rounded-xl border border-accent-border bg-accent-soft/40 px-4 py-3 text-sm leading-relaxed"
                  aria-live="polite"
                >
                  {phrases.length === 0 && !interim ? (
                    <p className="text-ink-faint">Lytter… begynn å snakke.</p>
                  ) : (
                    <p>
                      {phrases.join(" ")}{" "}
                      {interim && <span className="text-ink-faint">{interim}</span>}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Notater */}
            <div className="mt-6 w-full">
              <label htmlFor="notes" className="kicker block">
                Notater under samtalen
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Skriv hva motparten sier mens du prater — navn, firma, innvendinger, avtaler. Notatene gir AI-en motpartens side."
                className="mt-2 w-full resize-y rounded-xl border border-border bg-bg px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-ink-faint focus:border-accent-ink focus:bg-surface"
              />
            </div>

            {/* Filopplasting */}
            {!isRecording && phase !== "connecting" && (
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
      </Card>
    </div>
  );
}

function PipelineStatus({ steps, stepKey }: { steps: Step[]; stepKey: string }) {
  const idx = steps.findIndex((s) => s.key === stepKey);

  return (
    <div className="flex w-full max-w-xs flex-col gap-4 py-6" aria-live="polite">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          {i < idx || (i === idx && s.key === "DONE") ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-soft text-green-ink">
              <CheckIcon />
            </span>
          ) : i === idx ? (
            <Spinner />
          ) : (
            <span className="h-5 w-5 rounded-full border border-border" />
          )}
          <span className={`text-sm ${i <= idx ? "font-medium text-ink" : "text-ink-faint"}`}>
            {s.label}
            {i === idx && s.key !== "DONE" ? "…" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
