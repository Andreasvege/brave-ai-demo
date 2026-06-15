import { del } from "@vercel/blob";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]">
) {
  const { id } = await ctx.params;
  const call = await prisma.call.findUnique({ where: { id } });
  if (!call) return Response.json({ error: "Ikke funnet" }, { status: 404 });
  return Response.json(call);
}

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/calls/[id]">
) {
  const { id } = await ctx.params;
  const { title } = await req.json();
  const call = await prisma.call.update({
    where: { id },
    data: { title: title?.trim() || null },
  });
  return Response.json(call);
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]">
) {
  const { id } = await ctx.params;
  const call = await prisma.call.findUnique({ where: { id }, select: { audioUrl: true } });
  await prisma.call.delete({ where: { id } }).catch(() => null);
  if (call?.audioUrl) await del(call.audioUrl, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => null);
  return Response.json({ ok: true });
}
