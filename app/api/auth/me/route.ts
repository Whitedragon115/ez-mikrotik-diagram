// GET /api/auth/me — who is logged in, and whether Discord login is set up
// DELETE /api/auth/me — log out
import { NextResponse } from "next/server";
import { authConfig, currentUser, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = authConfig();
  return Response.json({ configured: cfg.configured, missing: cfg.missing, user: await currentUser() });
}

export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
