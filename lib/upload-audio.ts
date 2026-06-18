import { upload } from "@vercel/blob/client";

// Laster lydfila direkte fra nettleseren til Vercel Blob (privat), utenom
// request-body til /api/calls. Inline multipart-opplasting traff Vercels
// ~4,5 MB body-grense og feilet stille på lange opptak (> ~4 min).
// Returnerer blob-URL-en som sendes videre til POST /api/calls.
export async function uploadAudio(
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  const ext = (file.name.split(".").pop() || "webm").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "webm";
  // MediaRecorder gir ofte "audio/webm;codecs=opus" — strip codec-parameteren til
  // base-MIME, ellers matcher den ikke allowedContentTypes i /api/calls/upload.
  const contentType = file.type.split(";")[0].trim() || undefined;
  const blob = await upload(`calls/${crypto.randomUUID()}/audio.${ext}`, file, {
    access: "private",
    handleUploadUrl: "/api/calls/upload",
    contentType,
    onUploadProgress: onProgress
      ? ({ percentage }) => onProgress(percentage)
      : undefined,
  });
  return blob.url;
}

// Laster opp et ferdig opptak og starter pipelinen (POST /api/calls med blob-URL,
// ikke fila inline). Delt av PiP-widgeten og FAB-en. Kaster ved feil.
export async function submitRecordedBlob(
  blob: Blob,
  opts: { durationSec?: number; notes?: string; transcribeMode?: string; transcribeProvider?: string } = {}
): Promise<{ id?: string; error?: string }> {
  const file = new File([blob], "opptak.webm", { type: blob.type });
  const audioUrl = await uploadAudio(file);

  const formData = new FormData();
  formData.append("audioUrl", audioUrl);
  formData.append("transcribeMode", opts.transcribeMode ?? "batch");
  if (opts.transcribeProvider) formData.append("transcribeProvider", opts.transcribeProvider);
  formData.append("notes", opts.notes ?? "");
  if (opts.durationSec) formData.append("durationSec", String(opts.durationSec));

  const res = await fetch("/api/calls", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Feil ${res.status}`);
  return data;
}
