// Discord login (OAuth2 authorization-code flow) with a signed, HttpOnly session cookie.
// Server-side only.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "sim_session";
export const STATE_COOKIE = "sim_oauth_state";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string; // Discord user id
  name: string;
  avatar: string | null; // avatar URL
}

export function authConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  const appUrl = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const missing = [!clientId && "DISCORD_CLIENT_ID", !clientSecret && "DISCORD_CLIENT_SECRET", secret.length < 32 && "AUTH_SECRET (at least 32 characters)"].filter(Boolean) as string[];
  return {
    configured: missing.length === 0,
    missing,
    clientId,
    clientSecret,
    secret,
    appUrl,
    redirectUri: `${appUrl}/api/auth/discord/callback`,
    secureCookies: appUrl.startsWith("https://"),
  };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const hmac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function signSession(user: SessionUser, secret: string): string {
  const payload = b64url(JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 86400_000 }));
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): SessionUser | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(hmac(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionUser & { exp: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { id: data.id, name: data.name, avatar: data.avatar ?? null };
  } catch {
    return null;
  }
}

/** The logged-in user for the current request, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const cfg = authConfig();
  if (!cfg.configured) return null;
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, cfg.secret);
}

export const randomState = () => randomBytes(24).toString("base64url");

export const sessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: SESSION_DAYS * 86400,
});

/** Only allow same-site relative redirects after login. */
export const safeReturnTo = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/");
