import { get, put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { transcribeAudio } from "@/lib/transcribe";
import { analyzeTranscript } from "@/lib/analyze";

export const maxDuration = 300;

// Tre veier inn, alle synkrone:
//  - transcript (tekst): fra live-transkribering i nettleseren → rett til analyse
//  - audioUrl (string): batch/fil-veien. Klienten har allerede lastet lyden
//    direkte opp til Vercel Blob (privat) via /api/calls/upload — utenom
//    request-body, så Vercels ~4,5 MB body-grense rammer ikke lange opptak.
//  - audio (File): legacy/test-vei (f.eks. curl) der fila sendes inline.
// Klienten poller GET /api/calls for statusvisning mens kallet pågår.
export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  const audioUrl = (formData.get("audioUrl") as string | null)?.trim() || null;
  const liveTranscript = (formData.get("transcript") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const clientDuration = Number(formData.get("durationSec")) || null;
  const transcribeMode = (formData.get("transcribeMode") as string | null) || null;

  if (!(audio instanceof File) && !audioUrl && !liveTranscript) {
    return Response.json(
      { error: "Mangler lyd (felt: audioUrl eller audio) eller transkript (felt: transcript)" },
      { status: 400 }
    );
  }

  const call = await prisma.call.create({
    data: {
      status: "RECORDED",
      notes,
      durationSec: clientDuration,
      transcribeMode,
      audioUrl: audioUrl ?? undefined,
    },
  });

  try {
    let transcript: string;

    if (liveTranscript) {
      transcript = liveTranscript;
    } else {
      let audioBlob: Blob;
      let filename: string;

      if (audioUrl) {
        // Klient-opplastet: hent lyden fra privat blob og send til Azure.
        await prisma.call.update({ where: { id: call.id }, data: { status: "TRANSCRIBING" } });
        const result = await get(audioUrl, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
        if (!result || result.statusCode !== 200) {
          throw new Error("Fant ikke opplastet lydfil i blob-lagring");
        }
        const contentType = result.blob.contentType || "audio/webm";
        const ext = (audioUrl.split("?")[0].split(".").pop() || "webm").slice(0, 8);
        filename = `opptak.${ext}`;
        const arrayBuffer = await new Response(result.stream).arrayBuffer();
        audioBlob = new Blob([arrayBuffer], { type: contentType });
      } else {
        // Legacy/test: fila kom inline i request-body → last opp server-side.
        const audioFile = audio as File;
        const rawExt = (audioFile.name || "opptak.webm").split(".").pop() ?? "webm";
        const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "webm";
        const fname = `calls/${call.id}/audio.${safeExt}`;

        const [blob] = await Promise.all([
          put(fname, audioFile, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN }),
          prisma.call.update({ where: { id: call.id }, data: { status: "TRANSCRIBING" } }),
        ]);
        await prisma.call.update({ where: { id: call.id }, data: { audioUrl: blob.url } });
        audioBlob = audioFile;
        filename = audioFile.name || "opptak.webm";
      }

      const result = await transcribeAudio(audioBlob, filename);
      transcript = result.transcript;
      if (clientDuration == null && result.durationSec != null) {
        await prisma.call.update({
          where: { id: call.id },
          data: { durationSec: result.durationSec },
        });
      }
    }

    if (!transcript) throw new Error("Transkriptet ble tomt — ingen tale gjenkjent");

    await prisma.call.update({
      where: { id: call.id },
      data: { status: "ANALYZING", transcript },
    });

    const analysis = await analyzeTranscript(transcript, notes);

    const done = await prisma.call.update({
      where: { id: call.id },
      data: { status: "DONE", analysis },
    });

    return Response.json(done);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/calls] Pipeline feilet:", err);
    await prisma.call.update({
      where: { id: call.id },
      data: { status: "FAILED", error: message },
    });
    return Response.json({ id: call.id, error: message }, { status: 500 });
  }
}

export async function GET() {
  const calls = await prisma.call.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(calls);
}
