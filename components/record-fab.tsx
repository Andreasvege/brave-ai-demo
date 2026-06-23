"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactDOM from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MicIcon } from "@/components/icons";
import { PipRecordContent } from "@/components/pip-record-content";
import { submitLiveTranscript } from "@/lib/upload-audio";
import { finalizeLive, monitorMicLevel, type MicLevelMonitor } from "@/lib/recording";
import { getDefaultProvider } from "@/lib/transcription/client";
import { createLiveTranscriber } from "@/lib/transcription/live";
import type { LiveTranscriber } from "@/lib/transcription/types";
import { cn } from "@/lib/utils";

type Phase = "idle" | "open" | "connecting" | "recording" | "processing" | "error";

export function RecordFab() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [noAudio, setNoAudio] = useState(false);

  // Live-transkripsjon (aws-live el. valgt leverandør) — brukt i modal-fallbacken
  // når Document Picture-in-Picture ikke er tilgjengelig.
  const live = useRef<LiveTranscriber | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const micMonitor = useRef<MicLevelMonitor | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const provider = useRef(getDefaultProvider("live"));

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      micMonitor.current?.stop();
      const t = live.current;
      if (t) {
        // Rives ned midt i opptak: finaliser og lagre i stedet for å forkaste.
        const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
        const rec = mediaRecorder.current;
        const prov = provider.current;
        live.current = null;
        mediaRecorder.current = null;
        finalizeLive(t, rec, audioChunks.current)
          .then(({ transcript, audioFile }) => {
            const cleaned = transcript.replace(/\s+/g, " ").trim();
            if (!cleaned) return;
            return submitLiveTranscript(cleaned, { transcribeProvider: prov, durationSec, audioFile });
          })
          .catch((e) => console.error("FAB-nedriving: lagring av samtale feilet", e));
      } else {
        mediaRecorder.current?.stream?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startRecording() {
    setError(null);
    setPhase("connecting");
    try {
      provider.current = getDefaultProvider("live");
      const t = createLiveTranscriber(provider.current);
      t.onError = (err) => {
        setError(`Transkribering avbrutt: ${err.message}`);
        setPhase("error");
      };
      await t.start();
      live.current = t;

      // Ta også opp lyden parallelt (best-effort — live kjører uten lagret lyd ved feil).
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
      } catch {
        mediaRecorder.current = null;
      }

      startedAt.current = Date.now();
      setSeconds(0);
      timer.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
        1000
      );
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
    const t = live.current;
    if (!t) return;

    micMonitor.current?.stop();
    micMonitor.current = null;
    setNoAudio(false);
    const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
    const rec = mediaRecorder.current;
    live.current = null;
    mediaRecorder.current = null;

    setPhase("processing");
    try {
      const { transcript, audioFile } = await finalizeLive(t, rec, audioChunks.current);
      const cleaned = transcript.replace(/\s+/g, " ").trim();
      if (!cleaned) {
        setError("Ingen tale ble gjenkjent — transkriptet er tomt.");
        setPhase("error");
        return;
      }
      await submitLiveTranscript(cleaned, { transcribeProvider: provider.current, durationSec, audioFile });
      setPhase("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt");
      setPhase("error");
    }
  }

  function cancel() {
    if (timer.current) clearInterval(timer.current);
    live.current?.stop().catch(() => {});
    live.current = null;
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
            // Hold PiP-vinduet oppe etter en ferdig samtale — oppdater bare
            // samtalelista i hovedvinduet. Vinduet lukkes kun via X (onClose).
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
              ? "Lagrer og analyserer…"
              : isRecording
              ? "Tar opp — trykk for å stoppe"
              : "Trykk her for å åpne full versjon med notater"}
          </p>

          {isRecording && noAudio && (
            <p className="rounded-lg bg-amber-soft px-4 py-2 text-center text-sm text-amber-ink">
              ⚠️ Ingen lyd oppdaget — sjekk mikrofonen (Bluetooth?)
            </p>
          )}

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
