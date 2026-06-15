import { prisma } from "@/lib/db";
import { analyzeTranscript } from "@/lib/analyze";

export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/calls/[id]/reanalyze">
) {
  const { id } = await ctx.params;
  const { extraContext } = await req.json().catch(() => ({}));

  const call = await prisma.call.findUnique({ where: { id } });
  if (!call) return Response.json({ error: "Ikke funnet" }, { status: 404 });
  if (!call.transcript) return Response.json({ error: "Ingen transkripsjon å analysere" }, { status: 400 });

  await prisma.call.update({ where: { id }, data: { status: "ANALYZING" } });

  try {
    const analysis = await analyzeTranscript(call.transcript, call.notes ?? null, extraContext);
    const updated = await prisma.call.update({
      where: { id },
      data: { status: "DONE", analysis },
    });
    return Response.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.call.update({ where: { id }, data: { status: "FAILED", error: message } });
    return Response.json({ error: message }, { status: 500 });
  }
}
