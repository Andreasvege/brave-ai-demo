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
  const blob = await upload(`calls/${crypto.randomUUID()}/audio.${ext}`, file, {
    access: "private",
    handleUploadUrl: "/api/calls/upload",
    contentType: file.type || undefined,
    onUploadProgress: onProgress
      ? ({ percentage }) => onProgress(percentage)
      : undefined,
  });
  return blob.url;
}
