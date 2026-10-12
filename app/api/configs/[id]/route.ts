// GET /api/configs/:id — full saved config
// PUT /api/configs/:id — update name/description and/or overwrite the config
// DELETE /api/configs/:id
// Only the owner (logged in with Discord) can access a config.
import { prisma } from "@/lib/db";
import { parseBody, requireUser, summary, SUMMARY_SELECT } from "@/lib/configs-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Saved config not found." }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = await prisma.savedConfig.findFirst({ where: { id, ownerId: auth.user.id } });
  if (!row) return notFound();
  return Response.json({ ...summary(row), config: JSON.parse(row.config), packet: row.packet ? JSON.parse(row.packet) : null });
}

export async function PUT(req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const parsed = await parseBody(req, true);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { count } = await prisma.savedConfig.updateMany({ where: { id, ownerId: auth.user.id }, data: parsed.data });
  if (!count) return notFound();
  const row = await prisma.savedConfig.findUniqueOrThrow({ where: { id }, select: SUMMARY_SELECT });
  return Response.json(summary(row));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const { count } = await prisma.savedConfig.deleteMany({ where: { id, ownerId: auth.user.id } });
  if (!count) return notFound();
  return new Response(null, { status: 204 });
}
