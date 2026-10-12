# RouterOS Packet Flow Simulator

> ## ⚠️ AI awareness: please read
>
> **This project is fully "vibe coded". Almost all of the code was written by an AI, and it has _not_ been reviewed, audited or thoroughly tested by a human.**
>
> - **Do not trust the results blindly.** The simulator can be wrong: a rule may match when it shouldn't, a hook may be skipped, NAT or routing may behave differently from a real RouterOS. Always verify against your real router before you act on anything you see here.
> - **Never run the exported `.rsc` on a production router** without reading every line yourself.
> - **Don't store anything sensitive here.** Saved configs live in a database on this server, behind unaudited code. Router configs often contain secrets (IPsec keys, passwords, public addresses). Encrypt before saving, or better, don't save at all and use **Export** instead.
> - Bugs, data loss and security holes are all possible. Use it at your own risk.

An interactive MikroTik RouterOS packet-flow simulator. Configure a router (interfaces, bridges, addresses,
routes, firewall/NAT/mangle/raw rules, tunnels, IPsec, queues), send a test packet, and watch it travel through
every hook of the packet-flow diagram with each rule's match result.

```bash
cp .env.example .env    # DATABASE_URL for the SQLite database (data/app.db)
pnpm install            # also runs `prisma generate`
pnpm db:migrate         # create / update the local database
pnpm dev          # http://localhost:3000
pnpm check      # simulator sanity checks (all presets + replies)
pnpm build && pnpm start
```

## Using it

- **Canvas**: drag to pan, scroll / pinch to zoom at the pointer, `F` to fit, `+`/`-` to zoom.
- **Packet panel**: pick a preset or describe a packet (in-interface, addresses, protocol, ports, TTL, VLAN/GRE/IPIP/EoIP/ESP wrapping), then **Send packet**. **Send reply** sends the response back, so you can see connection tracking and NAT reversal.
- **Click any block** to configure it: chain blocks (PREROUTING, FORWARD, …) open their raw / mangle / NAT / filter rules, routing decisions open routes, IPsec blocks open policies, and so on. Rules can be added with the form or by pasting RouterOS commands such as `/ip firewall filter add chain=forward action=drop src-address=10.0.0.5`.
- **Trace panel**: step through with `←` / `→` / space. Each step shows its stages, which rules were checked and why they matched or not, and the packet fields that changed. The **Connections** tab shows the conntrack table.
- **Import your router**: **Import** (top bar) offers three ways in, each with instructions in the dialog:
  1. paste the output of `/export`;
  2. upload a `.rsc` file made with `/export file=sim-config`;
  3. connect with a read-only account. The app's server reads the RouterOS v7 REST API
     (`app/api/router-import`). This endpoint is disabled in production builds unless `ROUTER_IMPORT_ENABLED=true`,
     because it makes requests to whatever host it is given.

  Rules that use matchers the simulator doesn't support are imported disabled, with a note in their comment.
- **Router panel**: interfaces, addresses, routes, interface/address lists, the bridge host table, IPsec, queues; export as a `.rsc` script or JSON, import JSON, reset.

## Saving configurations

**Save / Load** in the top bar stores the current router setup and test packet in a SQLite database
(Prisma 7 with the `better-sqlite3` driver adapter). You can save a new copy, save changes, load, overwrite,
rename and delete. The API:

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/auth/me` | login status (`configured`, `user`); `DELETE` logs out |
| `GET` | `/api/auth/discord` | start Discord login (`?returnTo=/…`) |
| `GET` | `/api/configs` | list your configs (name, identity, dates) |
| `POST` | `/api/configs` | save `{ name, description?, config, packet? }` |
| `GET` | `/api/configs/:id` | full config |
| `PUT` | `/api/configs/:id` | rename and/or overwrite |
| `DELETE` | `/api/configs/:id` | delete |

Saving requires **Discord login**. Because this project is unaudited AI-written code, **don't save anything sensitive**. When you save, you can tick **Encrypt before saving**: the setup is encrypted in your browser with a passphrase (PBKDF2-SHA-256 → AES-256-GCM) and the server only stores ciphertext. The passphrase is never sent and **cannot be recovered**. The name and description stay readable, and the encryption code is itself unreviewed, so treat it as a convenience, not a guarantee.

Saving requires **Discord login**. Each saved config belongs to the Discord account that saved it, and the API
only returns your own (other users get 404). Everything else, including simulating, importing and exporting,
works without logging in.

### Setting up Discord login

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **OAuth2** → copy the **Client ID** and **Client Secret** into `.env` (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`).
3. **OAuth2 → Redirects** → add `${APP_URL}/api/auth/discord/callback`,
   e.g. `http://localhost:3000/api/auth/discord/callback`. It must match `APP_URL` exactly.
4. `AUTH_SECRET` signs the login cookie (≥ 32 characters). Your local `.env` already has a generated one.
   For other deployments, generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

Only the `identify` scope is requested (Discord ID, name, avatar). Sessions last 30 days in an HttpOnly cookie,
which is marked `Secure` when `APP_URL` is `https://`.

## Exporting

**Export** (top bar) gives you the current setup as a RouterOS-style `.rsc` script or as an exact `.json` backup.
Both can be loaded back with **Import**. **Don't run the `.rsc` on a real router:** it only contains what the
simulator models and can include placeholder addresses. The dialog and the file header both warn about this,
and the `.rsc` can only be copied or downloaded after ticking "I understand".

Schema: `prisma/schema.prisma`. After changing it, run `pnpm db:migrate`.

## Docker

```bash
docker compose up -d --build                         # http://localhost:3000 (reads DISCORD_*, AUTH_SECRET, APP_URL from .env)
PORT=8080 docker compose up -d                       # another host port
ROUTER_IMPORT_ENABLED=true docker compose up -d      # allow "Connect read-only" router import
```

- **Image:** multi-stage build on `node:24-bookworm-slim`, running Next.js in standalone mode as the non-root `node` user.
- **Database:** on start-up the container runs `prisma migrate deploy`, then starts the server. The SQLite file lives in the `app-data` volume (`/app/data/app.db`), so saved configs survive rebuilds.
- **Backup:** `docker compose cp app:/app/data/app.db ./backup.db`
- **Router import:** off in the container unless `ROUTER_IMPORT_ENABLED=true`, because it connects to addresses users type in.

## SEO

Titles, descriptions, keywords and structured data live in `lib/site.ts`. Next.js generates:
- `<title>`, meta description, canonical URL, Open Graph and Twitter tags (`app/layout.tsx`);
- a `WebApplication` JSON-LD block, marked free (`app/page.tsx`);
- `/robots.txt` (blocks `/api/` and `/preview`), `/sitemap.xml`, `/manifest.webmanifest`;
- the favicon (`app/icon.svg`) and the 1200×630 share image (`app/opengraph-image.tsx`).

The simulator renders in the browser, so the server-rendered loading screen (`components/SeoIntro.tsx`) carries the
crawlable heading and feature list. **Set `APP_URL` to the public address before building.** The canonical URL and
share-image links are written into the page at build time. Docker passes it as a build argument from `.env`.

## What is simulated

Bridging (bridge NAT/filter, use-ip-firewall, host table/flooding), raw, connection tracking
(new/established/untracked, NAT bindings, reply reversal, port remapping), mangle marks (packet / connection /
routing, TTL), DST-NAT / SRC-NAT / masquerade / redirect, filter accept/drop/reject, routing with longest prefix,
distance, routing tables and recursive gateways, TTL, IPsec tunnel policies (encrypt/decrypt), VLAN / GRE / IPIP /
EoIP encapsulation and decapsulation, simple queues and queue trees (match only).

Not simulated: MPLS (drawn for completeness), HotSpot, fasttrack's bypass, custom jump chains, rate limiting.

## Layout

- `lib/flow.ts`: diagram geometry (nodes, edges, layers) and chain stage definitions.
- `lib/sim/`: the simulator: `engine.ts` (packet walk), `types.ts`, `ip.ts`, `rules.ts` (tables, actions,
  RouterOS command parse/format), `nodes.ts` (node → editor mapping, `.rsc` export), `defaults.ts` (default config + presets).
- `lib/store.ts`: app state (zustand, persisted to localStorage).
- `lib/db.ts`, `prisma/`, `app/api/configs/`: saved configs (Prisma + SQLite).
- `components/canvas/`: the pan/zoom dot-grid canvas and the SVG graph.
- `components/panels/`: packet/router panel, inspector with rule editors, trace panel.
- `legacy/index.html`: the original static diagram.
