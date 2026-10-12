// Shared validation + serialization for the saved-config API.
import type { SavedConfig } from "@/lib/generated/prisma/client";
import { authConfig, currentUser, type SessionUser } from "@/lib/auth";
import { ENCRYPTED_IDENTITY, isEncryptedEnvelope } from "@/lib/crypto";

/** The logged-in user, or an error response (503 when login isn't set up, 401 when logged out). */
export async function requireUser(): Promise<{ user: SessionUser } | { response: Response }> {
  const cfg = authConfig();
  if (!cfg.configured)
    return { response: Response.json({ error: `Saving needs Discord login, which isn't configured on this server (missing ${cfg.missing.join(", ")}).`, code: "not-configured" }, { status: 503 }) };
  const user = await currentUser();
  if (!user) return { response: Response.json({ error: "Log in with Discord to save configs.", code: "login-required" }, { status: 401 }) };
  return { user };
}

const MAX_BYTES = 2_000_000;

export interface SavedSummary {
  id: string;
  name: string;
  description: string | null;
  identity: string;
  createdAt: string;
  updatedAt: string;
}

export const summary = (c: Pick<SavedConfig, "id" | "name" | "description" | "identity" | "createdAt" | "updatedAt">): SavedSummary => ({
  id: c.id,
  name: c.name,
  description: c.description,
  identity: c.identity,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const SUMMARY_SELECT = { id: true, name: true, description: true, identity: true, createdAt: true, updatedAt: true } as const;

type Parsed =
  | { ok: true; data: { name?: string; description?: string | null; config?: string; identity?: string; packet?: string | null } }
  | { ok: false; error: string };

/** Validate a create/update body. `partial` allows omitting fields (for updates). */
export async function parseBody(req: Request, partial: boolean): Promise<Parsed> {
  const text = await req.text();
  if (text.length > MAX_BYTES) return { ok: false, error: "Config is too large (max 2 MB)." };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "Body must be JSON." };
  }
  const out: { name?: string; description?: string | null; config?: string; identity?: string; packet?: string | null } = {};

  if (body.name !== undefined || !partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) return { ok: false, error: "Name must be 1–100 characters." };
    out.name = name;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") return { ok: false, error: "Description must be text." };
    out.description = typeof body.description === "string" ? body.description.trim().slice(0, 500) || null : null;
  }
  if (body.config !== undefined || !partial) {
    if (isEncryptedEnvelope(body.config)) {
      // encrypted in the browser: stored as-is, the router identity stays hidden too
      out.config = JSON.stringify(body.config);
      out.identity = ENCRYPTED_IDENTITY;
    } else {
      const cfg = body.config as { interfaces?: unknown; rules?: unknown; identity?: unknown } | undefined;
      if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.interfaces) || typeof cfg.rules !== "object")
        return { ok: false, error: "config must be a router configuration object." };
      out.config = JSON.stringify(cfg);
      out.identity = typeof cfg.identity === "string" ? cfg.identity.slice(0, 100) : "MikroTik";
    }
  }
  if (body.packet !== undefined) out.packet = body.packet === null ? null : JSON.stringify(body.packet);
  return { ok: true, data: out };
}
