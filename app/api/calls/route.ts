import { prisma } from "@/lib/db";
import { transcribeAudio } from "@/lib/transcribe";
import { analyzeTranscript } from "@/lib/analyze";

export const maxDuration = 300;

// Full pipeline synkront: opptak → transkribering → analyse → DONE.
// Klienten poller GET /api/calls/[id] for statusvisning mens kallet pågår.
export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const clientDuration = Number(formData.get("durationSec")) || null;

  if (!(audio instanceof File)) {
    return Response.json({ error: "Mangler lydfil (felt: audio)" }, { status: 400 });
  }

  const call = await prisma.call.create({
    data: { status: "RECORDED", notes, durationSec: clientDuration },
  });

  try {
    await prisma.call.update({
      where: { id: call.id },
      data: { status: "TRANSCRIBING" },
    });
    const { transcript, durationSec } = await transcribeAudio(
      audio,
      audio.name || "opptak.webm"
    );
    if (!transcript) throw new Error("Transkriptet ble tomt — ingen tale gjenkjent");

    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: "ANALYZING",
        transcript,
        durationSec: clientDuration ?? durationSec,
      },
    });

    const analysis = await analyzeTranscript(transcript, notes);

    const done = await prisma.call.update({
      where: { id: call.id },
      data: { status: "DONE", analysis: JSON.stringify(analysis) },
    });

    return Response.json({ ...done, analysis });
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
