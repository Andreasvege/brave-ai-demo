"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactDOM from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MicIcon } from "@/components/icons";
import { PipRecordContent } from "@/components/pip-record-content";
import { uploadAudio } from "@/lib/upload-audio";
import { cn } from "@/lib/utils";

type Phase = "idle" | "open" | "connecting" | "recording" | "processing" | "error";

export function RecordFab() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      mediaRecorder.current?.stream?.getTracks().forEach((t) => t.stop());
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
      durationRef.current = 0;
      setSeconds(0);
      timer.current = setInterval(() => {
        durationRef.current += 1;
        setSeconds((s) => s + 1);
      }, 1000);
      setPhase("recording");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Fikk ikke startet opptak. Sjekk mikrofontilgang i nettleseren."
      );
      setPhase("error");
    }
  }

  async function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    const recorder = mediaRecorder.current;
    if (!recorder) return;

    const durationSec = durationRef.current;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(audioChunks.current, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
    });
    mediaRecorder.current = null;

    setPhase("processing");
    try {
      const file = new File([blob], "opptak.webm", { type: blob.type });
      // Last lyden direkte opp til Vercel Blob — utenom request-body.
      const audioUrl = await uploadAudio(file);
      const formData = new FormData();
      formData.append("audioUrl", audioUrl);
      formData.append("transcribeMode", "batch");
      formData.append("notes", "");
      if (durationSec) formData.append("durationSec", String(durationSec));

      const res = await fetch("/api/calls", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Feil ${res.status}`);

      setPhase("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
      setPhase("error");
    }
  }

  function cancel() {
    if (timer.current) clearInterval(timer.current);
    const recorder = mediaRecorder.current;
    if (recorder) {
      recorder.stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
      mediaRecorder.current = null;
    }
    audioChunks.current = [];
    setSeconds(0);
    setError(null);
    setPhase("idle");
  }

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  const isRecording = phase === "recording";

  async function openPip() {
    if (!("documentPictureInPicture" in window)) {
      setPhase("open");
      return;
    }
    try {
      const pipWin = await (
        window as Window & { documentPictureInPicture: { requestWindow(opts: { width: number; height: number }): Promise<{ document: Document; close(): void; addEventListener(e: string, cb: () => void): void }> } }
      ).documentPictureInPicture.requestWindow({ width: 300, height: 80 });

      pipWin.document.documentElement.style.cssText = "height:100%;margin:0";
      pipWin.document.body.style.cssText = "height:100%;margin:0";

      const container = pipWin.document.createElement("div");
      container.style.height = "100%";
      pipWin.document.body.appendChild(container);

      const root = ReactDOM.createRoot(container);
      root.render(
        <PipRecordContent
          onDone={() => {
            root.unmount();
            pipWin.close();
            router.refresh();
          }}
          onClose={() => {
            root.unmount();
            pipWin.close();
          }}
        />
      );

      pipWin.addEventListener("pagehide", () => root.unmount());
    } catch {
      setPhase("open");
    }
  }

  if (phase === "idle") {
    return (
      <button
        onClick={openPip}
        aria-label="Start hurtigopptak"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-all hover:bg-accent-ink hover:scale-105"
      >
        <MicIcon width={22} height={22} />
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={!isRecording && phase !== "processing" ? () => router.push("/record") : undefined}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className={cn(
            "pointer-events-auto relative flex w-72 flex-col items-center gap-4 rounded-2xl bg-surface p-8 shadow-xl",
            (phase === "open" || phase === "error") && "cursor-pointer"
          )}
          onClick={phase === "open" || phase === "error" ? () => router.push("/record") : undefined}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isRecording) stopRecording();
              else startRecording();
            }}
            disabled={phase === "connecting" || phase === "processing"}
            aria-label={isRecording ? "Stopp opptak" : "Start opptak"}
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full transition-all disabled:opacity-60",
              isRecording
                ? "rec-pulse bg-accent text-white"
                : "border border-border-strong bg-bg text-ink hover:border-accent-ink hover:text-accent-ink"
            )}
          >
            {phase === "connecting" || phase === "processing" ? (
              <Spinner />
            ) : isRecording ? (
              <span className="block h-6 w-6 rounded-[4px] bg-white" />
            ) : (
              <MicIcon width={26} height={26} strokeWidth="1.6" />
            )}
          </button>

          <p className="font-mono text-2xl tabular-nums tracking-tight">
            {mm}:{ss}
          </p>

          <p className="text-center text-sm text-ink-faint">
            {phase === "connecting"
              ? "Kobler til…"
              : phase === "processing"
              ? "Transkriberer og analyserer…"
              : isRecording
              ? "Tar opp — trykk for å stoppe"
              : "Trykk her for å åpne full versjon med notater"}
          </p>

          {error && (
            <p className="rounded-lg bg-danger-soft px-4 py-2 text-center text-sm text-danger">
              {error}
            </p>
          )}

          <Button
            variant="dangerGhost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              cancel();
            }}
          >
            {isRecording ? "Avbryt opptak" : "Lukk"}
          </Button>
        </div>
      </div>
    </>
  );
}
