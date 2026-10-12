// Reads a RouterOS v7 configuration over its REST API with a (read-only) account.
// Credentials are used for this request only and never stored or logged.
import http from "node:http";
import https from "node:https";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** REST path → the CLI menu path the importer understands */
const ENDPOINTS: Record<string, string> = {
  "system/identity": "/system identity",
  interface: "/interface",
  "interface/bridge": "/interface bridge",
  "interface/bridge/port": "/interface bridge port",
  "interface/bridge/settings": "/interface bridge settings",
  "interface/bridge/filter": "/interface bridge filter",
  "interface/bridge/nat": "/interface bridge nat",
  "interface/vlan": "/interface vlan",
  "interface/gre": "/interface gre",
  "interface/ipip": "/interface ipip",
  "interface/eoip": "/interface eoip",
  "interface/list": "/interface list",
  "interface/list/member": "/interface list member",
  "ip/address": "/ip address",
  "ip/route": "/ip route",
  "routing/rule": "/routing rule",
  "ip/firewall/filter": "/ip firewall filter",
  "ip/firewall/nat": "/ip firewall nat",
  "ip/firewall/mangle": "/ip firewall mangle",
  "ip/firewall/raw": "/ip firewall raw",
  "ip/firewall/address-list": "/ip firewall address-list",
  "ip/ipsec/peer": "/ip ipsec peer",
  "ip/ipsec/policy": "/ip ipsec policy",
  "queue/simple": "/queue simple",
  "queue/tree": "/queue tree",
};

interface Body {
  host?: string;
  port?: number;
  https?: boolean;
  insecure?: boolean;
  username?: string;
  password?: string;
}

function get(url: URL, auth: string, insecure: boolean): Promise<{ status: number; body: string }> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      { method: "GET", headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }, timeout: 8000, ...(url.protocol === "https:" ? { rejectUnauthorized: !insecure } : {}) },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

const HOST_RE = /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$|^\d{1,3}(?:\.\d{1,3}){3}$|^\[[0-9a-fA-F:]+\]$/;

export async function POST(req: Request) {
  // This endpoint makes outbound requests to whatever host it is given, so it is meant for running the app
  // locally. On a public deployment it stays off unless ROUTER_IMPORT_ENABLED=true is set.
  if (process.env.NODE_ENV === "production" && process.env.ROUTER_IMPORT_ENABLED !== "true") {
    return Response.json({ error: "Router import is disabled on this deployment. Run the app locally, or set ROUTER_IMPORT_ENABLED=true." }, { status: 403 });
  }

  let b: Body;
  try {
    b = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400 });
  }
  const host = (b.host ?? "").trim();
  const port = Number(b.port) || (b.https ? 443 : 80);
  if (!HOST_RE.test(host)) return Response.json({ error: "Enter a router IP address or host name." }, { status: 400 });
  if (port < 1 || port > 65535) return Response.json({ error: "Port must be 1–65535." }, { status: 400 });
  if (!b.username) return Response.json({ error: "Enter the username of the read-only account." }, { status: 400 });

  const base = `${b.https ? "https" : "http"}://${host}:${port}/rest/`;
  const auth = Buffer.from(`${b.username}:${b.password ?? ""}`).toString("base64");

  // check login first so a wrong password produces one clear error
  try {
    const probe = await get(new URL("system/identity", base), auth, !!b.insecure);
    if (probe.status === 401) return Response.json({ error: "Login failed (401). Check the username/password and that the user's group has the rest-api and read policies." }, { status: 401 });
    if (probe.status === 403) return Response.json({ error: "Access denied (403). Add the rest-api and read policies to the user's group." }, { status: 403 });
    if (probe.status === 404) return Response.json({ error: "No REST API at this address (404). RouterOS v7 is required, and the www or www-ssl service must be enabled." }, { status: 502 });
    if (probe.status >= 400) return Response.json({ error: `Router answered HTTP ${probe.status}.` }, { status: 502 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /self[- ]signed|certificate/i.test(msg)
      ? " The router uses a self-signed certificate: tick “Accept self-signed certificate”."
      : /ECONNREFUSED/.test(msg)
        ? ` Nothing is listening on port ${port}. Is the ${b.https ? "www-ssl" : "www"} service enabled?`
        : "";
    return Response.json({ error: `Could not reach ${host}:${port}: ${msg}.${hint}` }, { status: 502 });
  }

  const sections: Record<string, Record<string, string>[]> = {};
  const errors: string[] = [];
  await Promise.all(
    Object.entries(ENDPOINTS).map(async ([rest, menu]) => {
      try {
        const r = await get(new URL(rest, base), auth, !!b.insecure);
        if (r.status === 404 || r.status === 400) return; // package/menu not present on this router
        if (r.status >= 400) {
          errors.push(`${menu}: HTTP ${r.status}`);
          return;
        }
        const data = JSON.parse(r.body) as unknown;
        sections[menu] = (Array.isArray(data) ? data : [data]) as Record<string, string>[];
      } catch (e) {
        errors.push(`${menu}: ${e instanceof Error ? e.message : e}`);
      }
    }),
  );
  return Response.json({ sections, errors });
}
