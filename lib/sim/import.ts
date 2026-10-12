// Import a real RouterOS configuration: parse `/export` scripts (.rsc) or REST API rows,
// then convert the parts the simulator understands into a RouterConfig.
import { newId, rosToRuleKey, TABLE_INFO } from "./rules";
import { isIp } from "./ip";
import type { Iface, IfaceType, RouterConfig, RoutingRuleAction, Rule, Table } from "./types";

/** One `add`/`set` line (or one REST object): RouterOS property → value */
export type Row = Record<string, string>;
/** Menu path ("/ip firewall filter") → rows */
export type Sections = Record<string, Row[]>;

export interface ImportResult {
  cfg: RouterConfig;
  stats: { label: string; count: number }[];
  warnings: string[];
  ignored: string[];
  source: string;
}

/* ---------------- /export parser ---------------- */

/** Undo RouterOS string escaping: \" \\ \n \t \_ and \XX hex bytes (UTF-8). */
function unescapeRos(s: string): string {
  const bytes: number[] = [];
  let out = "";
  const flush = () => {
    if (bytes.length) {
      out += new TextDecoder().decode(new Uint8Array(bytes));
      bytes.length = 0;
    }
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9A-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
      flush();
      const n = s[++i];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === "_" ? " " : n;
      continue;
    }
    flush();
    out += c;
  }
  flush();
  return out;
}

/** Split a command line into tokens, keeping "quoted values" and [ find … ] together. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t") {
      i++;
      continue;
    }
    let j = i;
    if (line[i] === "[") {
      let depth = 0;
      for (; j < line.length; j++) {
        if (line[j] === "[") depth++;
        else if (line[j] === "]" && --depth === 0) break;
      }
      out.push(line.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let inQ = false;
    for (; j < line.length; j++) {
      const c = line[j];
      if (c === "\\" && inQ) {
        j++;
        continue;
      }
      if (c === '"') inQ = !inQ;
      else if ((c === " " || c === "\t") && !inQ) break;
    }
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

const COMMANDS = new Set(["add", "set", "remove", "enable", "disable", "print", "export", "comment", "move", "unset", "reset", "edit"]);

/** Parse `/export` (or `/export terse`) output into menu sections. */
export function parseExport(text: string): { sections: Sections; warnings: string[] } {
  const sections: Sections = {};
  const warnings: string[] = [];
  // join "\"-continued lines (continuations are indented by 4 spaces)
  const logical: string[] = [];
  let buf = "";
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = buf ? raw.replace(/^ {4}/, "") : raw;
    if (/(^|[^\\])\\$/.test(line)) {
      buf += line.slice(0, -1);
      continue;
    }
    logical.push(buf + line);
    buf = "";
  }
  if (buf) logical.push(buf);

  let path = "/";
  for (const original of logical) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith(":")) {
      warnings.push(`Skipped scripting line: ${line.slice(0, 60)}`);
      continue;
    }
    let tokens = tokenize(line);
    if (line.startsWith("/")) {
      const parts: string[] = [];
      while (tokens.length && !tokens[0].includes("=") && !COMMANDS.has(tokens[0]) && !tokens[0].startsWith("[")) parts.push(tokens.shift()!);
      path = ("/" + parts.join(" ").replace(/^\/+/, "")).replace(/\s+/g, " ");
      if (!tokens.length) continue;
    }
    const cmd = tokens.shift()!;
    if (cmd !== "add" && cmd !== "set") {
      if (COMMANDS.has(cmd)) warnings.push(`Skipped "${cmd}" in ${path}`);
      continue;
    }
    const row: Row = { __cmd: cmd };
    for (const t of tokens) {
      if (t.startsWith("[")) {
        const m = t.match(/(?:default-name|name)=("?)([^"\]\s]+)\1/);
        if (m) row.__find = m[2];
        continue;
      }
      const eq = t.indexOf("=");
      if (eq < 0) {
        // `set ether1 comment=…` style item reference
        if (cmd === "set" && !row.__find) row.__find = t;
        continue;
      }
      const k = t.slice(0, eq);
      let v = t.slice(eq + 1);
      if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = unescapeRos(v.slice(1, -1));
      row[k] = v;
    }
    (sections[path] ??= []).push(row);
  }
  return { sections, warnings };
}

/* ---------------- convert sections → RouterConfig ---------------- */

const yes = (v?: string) => v === "yes" || v === "true";
const RULE_PATHS: Record<string, Table> = {
  "/ip firewall filter": "filter",
  "/ip firewall nat": "nat",
  "/ip firewall mangle": "mangle",
  "/ip firewall raw": "raw",
  "/interface bridge filter": "bridge-filter",
  "/interface bridge nat": "bridge-nat",
};
/** read-only REST fields and options that don't change matching */
const SKIP_KEYS = new Set([".id", ".nextid", "bytes", "packets", "dynamic", "invalid", "log", "log-prefix", "hw-offload", "reject-with", "address-list-timeout", "address-list", "place-before", "new-mss", "new-dscp", "new-priority", "sniff-target", "sniff-target-port", "sniff-id", "jump-target", "default", "builtin", "__cmd", "__find"]);
/** actions we don't model but that never stop the chain: simulate as passthrough */
const NON_TERMINAL = new Set(["add-src-to-address-list", "add-dst-to-address-list", "change-mss", "change-dscp", "set-priority", "sniff-tzsp", "sniff-pc", "strip-ipv4-options", "clear-df"]);
const GENERIC_IFACES = new Set(["wireguard", "pppoe-client", "l2tp-client", "sstp-client", "ovpn-client", "pptp-client", "wifi", "wireless", "veth", "macvlan", "vxlan", "lte", "bonding", "6to4", "vrrp"]);
const IFACE_TYPE: Record<string, IfaceType> = {
  ether: "ether", bridge: "bridge", vlan: "vlan", gre: "gre", "gre-tunnel": "gre", ipip: "ipip", "ipip-tunnel": "ipip", eoip: "eoip", "eoip-tunnel": "eoip",
};

export function buildConfig(sections: Sections, warnings: string[], source: string): ImportResult {
  const cfg: RouterConfig = {
    identity: "MikroTik",
    interfaces: [],
    addresses: [],
    routes: [],
    routingRules: [],
    interfaceLists: [],
    addressLists: [],
    bridgeHosts: [],
    bridge: { useIpFirewall: false },
    ipsecPolicies: [],
    simpleQueues: [],
    queueTrees: [],
    rules: { filter: [], nat: [], mangle: [], raw: [], "bridge-filter": [], "bridge-nat": [] },
  };
  const ignored = new Map<string, number>();
  const rows = (p: string) => (sections[p] ?? []).filter((r) => !yes(r.dynamic));

  const iface = (name: string | undefined, type: IfaceType = "ether"): Iface | undefined => {
    if (!name || name === "none" || name === "all") return undefined;
    let i = cfg.interfaces.find((x) => x.name === name);
    if (!i) {
      i = { name, type };
      cfg.interfaces.push(i);
    } else if (type !== "ether" && i.type === "ether") i.type = type;
    return i;
  };
  const common = (i: Iface | undefined, r: Row) => {
    if (!i) return;
    if (r.comment) i.comment = r.comment;
    if (yes(r.disabled)) i.disabled = true;
  };

  for (const r of sections["/system identity"] ?? []) if (r.name) cfg.identity = r.name;

  // REST: full interface list with types
  for (const r of sections["/interface"] ?? []) {
    if (!r.name || r.type === "loopback") continue;
    const t = IFACE_TYPE[r.type ?? "ether"];
    const i = iface(r.name, t ?? "ether");
    common(i, r);
    if (i && !t && !i.comment) i.comment = `[${r.type}]`;
  }
  for (const r of sections["/interface ethernet"] ?? []) {
    const target = r.__find ?? r["default-name"] ?? r.name;
    const i = iface(target);
    if (i && r.name && r.name !== target) i.name = r.name;
    common(i, r);
  }
  for (const r of rows("/interface bridge")) common(iface(r.name, "bridge"), r);
  for (const r of rows("/interface vlan")) {
    const i = iface(r.name, "vlan");
    if (i) Object.assign(i, { vlanId: Number(r["vlan-id"]) || 1, parent: r.interface });
    iface(r.interface);
    common(i, r);
  }
  for (const t of ["gre", "ipip", "eoip"] as const) {
    for (const r of rows(`/interface ${t}`)) {
      const i = iface(r.name, t);
      if (i) Object.assign(i, { local: r["local-address"] && r["local-address"] !== "0.0.0.0" ? r["local-address"] : undefined, remote: r["remote-address"] });
      common(i, r);
    }
  }
  for (const [path, list] of Object.entries(sections)) {
    const kind = path.replace(/^\/interface /, "");
    if (path.startsWith("/interface ") && GENERIC_IFACES.has(kind))
      for (const r of list) {
        const i = iface(r.name);
        if (i && !i.comment) i.comment = r.comment ?? `[${kind}]`;
      }
  }
  for (const r of rows("/interface bridge port")) {
    const br = iface(r.bridge, "bridge");
    const i = iface(r.interface);
    if (i && br) i.bridge = br.name;
  }
  for (const r of sections["/interface bridge settings"] ?? []) if (r["use-ip-firewall"]) cfg.bridge.useIpFirewall = yes(r["use-ip-firewall"]);

  // interface lists
  const BUILTIN_LISTS = new Set(["all", "none", "dynamic", "static"]);
  const list = (name: string) => {
    let l = cfg.interfaceLists.find((x) => x.name === name);
    if (!l) cfg.interfaceLists.push((l = { name, members: "" }));
    return l;
  };
  for (const r of rows("/interface list")) if (r.name && !BUILTIN_LISTS.has(r.name) && !yes(r.builtin)) list(r.name);
  for (const r of rows("/interface list member")) {
    if (!r.list || !r.interface || BUILTIN_LISTS.has(r.list)) continue;
    const l = list(r.list);
    l.members = [...l.members.split(",").filter(Boolean), r.interface].join(",");
    iface(r.interface);
  }

  // addresses & routes
  for (const r of sections["/ip address"] ?? []) {
    if (!r.address) continue;
    cfg.addresses.push({ address: r.address.includes("/") ? r.address : `${r.address}/32`, interface: r.interface, disabled: yes(r.disabled) || undefined });
    iface(r.interface);
  }
  for (const r of sections["/ip route"] ?? []) {
    if (yes(r.connect) || (yes(r.dynamic) && !r.gateway)) continue; // connected routes are rebuilt from addresses
    const gw = (r.gateway ?? "").split(",")[0].split("%")[0];
    if (!gw) {
      warnings.push(`Route ${r["dst-address"] ?? "0.0.0.0/0"} has no gateway (type=${r.type ?? "?"}): skipped.`);
      continue;
    }
    if (!isIp(gw)) iface(gw);
    cfg.routes.push({
      dst: r["dst-address"] ?? "0.0.0.0/0",
      gateway: gw,
      distance: Number(r.distance ?? 1) || 1,
      table: r["routing-table"] ?? r["routing-mark"] ?? "main",
      comment: r.comment ?? (yes(r.dynamic) ? `[dynamic${yes(r.dhcp) ? ", from DHCP" : ""}]` : undefined),
      disabled: yes(r.disabled) || undefined,
    });
  }

  // policy routing rules
  const RR_ACTIONS: RoutingRuleAction[] = ["lookup", "lookup-only-in-table", "drop", "unreachable"];
  const RR_KEYS: Record<string, "srcAddress" | "dstAddress" | "routingMark" | "interface" | "table" | "comment"> = {
    "src-address": "srcAddress", "dst-address": "dstAddress", "routing-mark": "routingMark", interface: "interface", table: "table", comment: "comment",
  };
  for (const [n, r] of rows("/routing rule").entries()) {
    const rule: NonNullable<RouterConfig["routingRules"]>[number] = { action: "lookup", table: "main", disabled: yes(r.disabled) || undefined };
    const problems: string[] = [];
    for (const [k, v] of Object.entries(r)) {
      if (k === "disabled" || SKIP_KEYS.has(k)) continue;
      if (k === "action") {
        if (RR_ACTIONS.includes(v as RoutingRuleAction)) rule.action = v as RoutingRuleAction;
        else problems.push(`action=${v}`);
      } else if (RR_KEYS[k]) rule[RR_KEYS[k]] = v;
      else problems.push(`${k}=${v}`);
    }
    if (rule.interface) iface(rule.interface);
    if (problems.length) {
      // an unsupported matcher could make the rule match far more than it should: keep it, but disabled
      rule.comment = `[not simulated: ${problems.join(", ")}]${rule.comment ? " " + rule.comment : ""}`;
      if (!rule.disabled) warnings.push(`/routing rule #${n}: imported disabled (${problems.join(", ")})`);
      rule.disabled = true;
    }
    cfg.routingRules!.push(rule);
  }

  // Dynamic WAN state is not part of /export: recreate what DHCP / PPPoE / VPN clients would add
  const hasDefault = () => cfg.routes.some((x) => x.dst === "0.0.0.0/0" && x.table === "main" && !x.disabled);
  // PPPoE/VPN clients first: when both exist, their default route is the one that wins on a real router
  const clients: [string, Row][] = [
    ...["pppoe-client", "l2tp-client", "sstp-client", "ovpn-client", "pptp-client"].flatMap((k) => (sections[`/interface ${k}`] ?? []).map((r) => [k, r] as [string, Row])),
    ...(sections["/ip dhcp-client"] ?? []).map((r) => ["dhcp", r] as [string, Row]),
  ];
  let n = 0;
  for (const [kind, r] of clients) {
    const name = kind === "dhcp" ? r.interface : r.name;
    if (!name || yes(r.disabled)) continue;
    const isDhcp = kind === "dhcp";
    const label = isDhcp ? "DHCP client" : `${kind} (${name})`;
    const wantsDefault = isDhcp ? r["add-default-route"] !== "no" : yes(r["add-default-route"]) || (kind === "pppoe-client" && !hasDefault());
    iface(name);
    if (!cfg.addresses.some((a) => a.interface === name)) {
      n++;
      const addr = isDhcp ? `198.18.${n}.2/24` : `100.64.${n}.2/32`;
      cfg.addresses.push({ address: addr, interface: name });
      warnings.push(`${name}: its address comes from the ${label} and isn't in the export, so the placeholder ${addr} was added. Change it under Router → IP addresses.`);
    }
    if (wantsDefault && !hasDefault()) {
      cfg.routes.push({ dst: "0.0.0.0/0", gateway: name, distance: Number(r["default-route-distance"] ?? 1) || 1, table: "main", comment: `[dynamic] default route from ${label}` });
      warnings.push(`Added default route 0.0.0.0/0 via ${name}: the ${label} creates it dynamically (add-default-route), so it isn't in the export.`);
    }
  }

  // firewall
  for (const [path, table] of Object.entries(RULE_PATHS)) {
    for (const [n, r] of rows(path).entries()) {
      const rule = convertRule(table, r, (msg) => warnings.push(`${TABLE_INFO[table].menu} #${n}: ${msg}`));
      if (rule) cfg.rules[table].push(rule);
    }
  }
  for (const r of rows("/ip firewall address-list")) if (r.list && r.address) cfg.addressLists.push({ list: r.list, address: r.address });

  // IPsec
  const peers = new Map<string, { address: string; local?: string }>();
  for (const r of rows("/ip ipsec peer")) if (r.name) peers.set(r.name, { address: (r.address ?? "").split("/")[0], local: r["local-address"] });
  for (const r of rows("/ip ipsec policy")) {
    if (yes(r.template) || yes(r.default)) continue;
    const peer = r.peer ? peers.get(r.peer) : undefined;
    const saDst = (r["sa-dst-address"] ?? peer?.address ?? "").split("/")[0];
    const saSrc = (r["sa-src-address"] ?? peer?.local ?? "").split("/")[0];
    if (!isIp(saDst)) {
      warnings.push(`IPsec policy ${r["src-address"]} → ${r["dst-address"]}: no peer address, skipped.`);
      continue;
    }
    if (!yes(r.tunnel ?? "no")) warnings.push(`IPsec policy ${r["src-address"]} → ${r["dst-address"]}: transport mode simulated as tunnel mode.`);
    cfg.ipsecPolicies.push({
      src: r["src-address"] ?? "0.0.0.0/0",
      dst: r["dst-address"] ?? "0.0.0.0/0",
      action: (r.action as "encrypt" | "discard" | "none") ?? "encrypt",
      saSrc: isIp(saSrc) ? saSrc : cfg.addresses[0]?.address.split("/")[0] ?? "0.0.0.0",
      saDst,
      disabled: yes(r.disabled) || undefined,
    });
  }

  // queues
  for (const r of rows("/queue simple")) cfg.simpleQueues.push({ name: r.name ?? "queue", target: (r.target ?? "").replace(/,\s*/g, ","), maxLimit: r["max-limit"] ?? "", disabled: yes(r.disabled) || undefined });
  for (const r of rows("/queue tree")) cfg.queueTrees.push({ name: r.name ?? "queue", parent: r.parent ?? "global", packetMark: r["packet-mark"] ?? "", maxLimit: r["max-limit"] ?? "", disabled: yes(r.disabled) || undefined });

  // everything else is outside the simulation
  const HANDLED = new Set([
    "/system identity", "/interface", "/interface ethernet", "/interface bridge", "/interface vlan", "/interface gre", "/interface ipip", "/interface eoip",
    "/interface bridge port", "/interface bridge settings", "/interface list", "/interface list member", "/ip address", "/ip route", "/routing rule",
    "/ip firewall address-list", "/ip ipsec peer", "/ip dhcp-client", "/ip ipsec policy", "/queue simple", "/queue tree", ...Object.keys(RULE_PATHS),
  ]);
  for (const [p, l] of Object.entries(sections)) {
    if (HANDLED.has(p) || (p.startsWith("/interface ") && GENERIC_IFACES.has(p.slice(11)))) continue;
    ignored.set(p, (ignored.get(p) ?? 0) + l.length);
  }

  if (!cfg.interfaces.length) warnings.push("No interfaces found. Is this a full /export?");
  cfg.interfaces.sort((a, b) => (a.type === "ether" ? 0 : 1) - (b.type === "ether" ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  const ruleCount = (t: Table) => cfg.rules[t].length;
  return {
    cfg,
    source,
    warnings,
    ignored: [...ignored.entries()].map(([p, n]) => `${p} (${n})`),
    stats: [
      { label: "Interfaces", count: cfg.interfaces.length },
      { label: "Bridge ports", count: cfg.interfaces.filter((i) => i.bridge).length },
      { label: "IP addresses", count: cfg.addresses.length },
      { label: "Routes", count: cfg.routes.length },
      { label: "Routing rules", count: cfg.routingRules!.length },
      { label: "Interface lists", count: cfg.interfaceLists.length },
      { label: "Address-list entries", count: cfg.addressLists.length },
      { label: "Filter rules", count: ruleCount("filter") },
      { label: "NAT rules", count: ruleCount("nat") },
      { label: "Mangle rules", count: ruleCount("mangle") },
      { label: "Raw rules", count: ruleCount("raw") },
      { label: "Bridge filter/NAT", count: ruleCount("bridge-filter") + ruleCount("bridge-nat") },
      { label: "IPsec policies", count: cfg.ipsecPolicies.length },
      { label: "Queues", count: cfg.simpleQueues.length + cfg.queueTrees.length },
    ],
  };
}

function convertRule(table: Table, r: Row, warn: (msg: string) => void): Rule | null {
  const info = TABLE_INFO[table];
  const rule: Rule = { id: newId(), chain: r.chain ?? "", action: r.action ?? "accept" };
  const problems: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (k === "chain" || k === "action" || SKIP_KEYS.has(k)) continue;
    const key = rosToRuleKey(k);
    if (!key) {
      problems.push(`${k}=${v}`);
      continue;
    }
    if (key === "disabled" || key === "passthrough") rule[key] = yes(v);
    else (rule[key] as string) = v;
  }
  if (!info.actions.includes(rule.action)) {
    if (NON_TERMINAL.has(rule.action)) {
      warn(`action=${rule.action} simulated as passthrough`);
      rule.comment = `[${rule.action}] ${rule.comment ?? ""}`.trim();
      rule.action = "passthrough";
    } else if (rule.action === "tarpit") {
      rule.action = "drop";
    } else problems.push(`action=${rule.action}`);
  }
  if (!info.chains.includes(rule.chain)) problems.push(`custom chain "${rule.chain}"`);
  if (rule.action.startsWith("mark-") || rule.action === "change-ttl") rule.passthrough ??= true;
  if (problems.length) {
    // a rule with an unsupported matcher could match far more than it should, so keep it but disabled
    if (!info.chains.includes(rule.chain)) rule.chain = info.chains[0];
    if (!info.actions.includes(rule.action)) rule.action = "passthrough";
    rule.comment = `[not simulated: ${problems.join(", ")}]${rule.comment ? " " + rule.comment : ""}`;
    if (!rule.disabled) warn(`imported disabled (${problems.join(", ")})`);
    rule.disabled = true;
  }
  return rule;
}

export function importScript(text: string, source = "pasted /export"): ImportResult {
  const { sections, warnings } = parseExport(text);
  return buildConfig(sections, warnings, source);
}
