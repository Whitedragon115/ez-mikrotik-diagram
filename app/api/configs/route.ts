// GET /api/configs — list your saved configs (without their contents)
// POST /api/configs — save a new config { name, description?, config, packet? }
// Requires Discord login; every user only sees their own configs.
import { prisma } from "@/lib/db";
import { parseBody, requireUser, summary, SUMMARY_SELECT } from "@/lib/configs-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const rows = await prisma.savedConfig.findMany({ where: { ownerId: auth.user.id }, select: SUMMARY_SELECT, orderBy: { updatedAt: "desc" } });
  return Response.json(rows.map(summary));
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(req, false);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { name, description, config, identity, packet } = parsed.data;
  const row = await prisma.savedConfig.create({
    data: { ownerId: auth.user.id, name: name!, description: description ?? null, config: config!, identity: identity!, packet: packet ?? null },
    select: SUMMARY_SELECT,
  });
  return Response.json(summary(row), { status: 201 });
}
