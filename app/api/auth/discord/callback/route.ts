// GET /api/auth/discord/callback — Discord redirects here after the user approves
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfig, safeReturnTo, SESSION_COOKIE, sessionCookieOptions, signSession, STATE_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export async function GET(req: Request) {
  const cfg = authConfig();
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const [expectedState, returnToRaw] = (jar.get(STATE_COOKIE)?.value ?? "").split("|");
  const returnTo = safeReturnTo(returnToRaw ?? "/");
  const back = (status: string) => {
    const url = new URL(returnTo, cfg.appUrl);
    url.searchParams.set("login", status);
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    return res;
  };

  if (!cfg.configured) return back("not-configured");
  if (params.get("error")) return back("cancelled");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || state !== expectedState) return back("invalid-state");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.redirectUri,
      }),
    });
    if (!tokenRes.ok) return back("token-failed");
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return back("token-failed");

    const meRes = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) return back("profile-failed");
    const me = (await meRes.json()) as DiscordUser;
    const name = me.global_name || me.username;
    const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null;

    await prisma.user.upsert({
      where: { id: me.id },
      create: { id: me.id, username: name, avatar },
      update: { username: name, avatar },
    });

    const res = back("ok");
    res.cookies.set(SESSION_COOKIE, signSession({ id: me.id, name, avatar }, cfg.secret), sessionCookieOptions(cfg.secureCookies));
    return res;
  } catch {
    return back("error");
  }
}
