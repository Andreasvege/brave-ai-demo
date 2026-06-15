import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]/audio">
) {
  const { id } = await ctx.params;
  const call = await prisma.call.findUnique({ where: { id }, select: { audioUrl: true } });
  if (!call?.audioUrl) return Response.json({ error: "Ingen lydfil" }, { status: 404 });

  const result = await get(call.audioUrl, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!result || result.statusCode !== 200) {
    return Response.json({ error: "Fant ikke lydfil i blob-lagring" }, { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType || "audio/webm",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
