import { prisma } from "@/lib/db";
import { transcribeAudio } from "@/lib/transcribe";
import { analyzeTranscript } from "@/lib/analyze";

export const maxDuration = 300;

// To veier inn, begge synkrone:
//  - transcript (tekst): fra live-transkribering i nettleseren → rett til analyse
//  - audio (fil): batch-veien → Azure fast transcription → analyse
// Klienten poller GET /api/calls for statusvisning mens kallet pågår.
export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  const liveTranscript = (formData.get("transcript") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const clientDuration = Number(formData.get("durationSec")) || null;
  const transcribeMode = (formData.get("transcribeMode") as string | null) || null;

  if (!(audio instanceof File) && !liveTranscript) {
    return Response.json(
      { error: "Mangler lydfil (felt: audio) eller transkript (felt: transcript)" },
      { status: 400 }
    );
  }

  const call = await prisma.call.create({
    data: { status: "RECORDED", notes, durationSec: clientDuration, transcribeMode },
  });

  try {
    let transcript: string;

    if (liveTranscript) {
      transcript = liveTranscript;
    } else {
      await prisma.call.update({
        where: { id: call.id },
        data: { status: "TRANSCRIBING" },
      });
      const result = await transcribeAudio(
        audio as File,
        (audio as File).name || "opptak.webm"
      );
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
