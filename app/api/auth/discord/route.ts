// GET /api/auth/discord?returnTo=/… — start the Discord login
import { NextResponse } from "next/server";
import { authConfig, randomState, safeReturnTo, STATE_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = authConfig();
  if (!cfg.configured) {
    return Response.json({ error: `Discord login is not configured. Missing: ${cfg.missing.join(", ")}.` }, { status: 503 });
  }
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
  const state = randomState();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    scope: "identify",
    state,
    prompt: "none",
  }).toString();

  const res = NextResponse.redirect(url);
  // state + where to go afterwards, checked in the callback (10 minutes)
  res.cookies.set(STATE_COOKIE, `${state}|${returnTo}`, { httpOnly: true, sameSite: "lax", secure: cfg.secureCookies, path: "/api/auth", maxAge: 600 });
  return res;
}
