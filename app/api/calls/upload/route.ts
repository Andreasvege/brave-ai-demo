import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// Utsteder klient-token for direkte opplasting av lyd til Vercel Blob.
// Klienten (record-side, PiP-widget, filopplasting) kaller dette via
// `upload(..., { handleUploadUrl: "/api/calls/upload" })`. Ruten er beskyttet
// av middleware (kun innloggede @brave.no-brukere).
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "audio/webm",
          "audio/ogg",
          "audio/mp4",
          "audio/x-m4a",
          "audio/m4a",
          "audio/mpeg",
          "audio/wav",
          "audio/x-wav",
          "application/octet-stream",
        ],
        // Romslig tak — dekker flere timers opptak. Body-grensen finnes ikke
        // her siden fila går browser → Blob, ikke gjennom funksjonen.
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: false,
      }),
      // Ingen onUploadCompleted: pipelinen kjøres synkront i POST /api/calls
      // rett etter at klienten har fått blob-URL-en.
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kunne ikke generere opplastingstoken";
    return Response.json({ error: message }, { status: 400 });
  }
}
