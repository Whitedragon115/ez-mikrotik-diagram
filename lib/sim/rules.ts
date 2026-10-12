// Rule tables, chains, actions, and RouterOS-style command parsing/formatting.
import type { Rule, Table } from "./types";

export const TABLE_INFO: Record<Table, { label: string; menu: string; chains: string[]; actions: string[] }> = {
  raw: { label: "Raw", menu: "/ip firewall raw", chains: ["prerouting", "output"], actions: ["accept", "drop", "notrack", "log", "passthrough"] },
  mangle: {
    label: "Mangle",
    menu: "/ip firewall mangle",
    chains: ["prerouting", "input", "forward", "output", "postrouting"],
    actions: ["mark-connection", "mark-packet", "mark-routing", "change-ttl", "accept", "log", "passthrough"],
  },
  nat: { label: "NAT", menu: "/ip firewall nat", chains: ["dstnat", "srcnat"], actions: ["masquerade", "src-nat", "dst-nat", "redirect", "accept", "log", "passthrough"] },
  filter: {
    label: "Filter",
    menu: "/ip firewall filter",
    chains: ["input", "forward", "output"],
    actions: ["accept", "drop", "reject", "fasttrack-connection", "log", "passthrough"],
  },
  "bridge-filter": { label: "Bridge filter", menu: "/interface bridge filter", chains: ["input", "forward", "output"], actions: ["accept", "drop", "log", "passthrough"] },
  "bridge-nat": { label: "Bridge NAT", menu: "/interface bridge nat", chains: ["dstnat", "srcnat"], actions: ["accept", "drop", "log", "passthrough"] },
};

export type RuleKey = Exclude<keyof Rule, "id">;

/** field key → RouterOS property name */
export const ROS_NAMES: [RuleKey, string][] = [
  ["chain", "chain"],
  ["action", "action"],
  ["srcAddress", "src-address"],
  ["dstAddress", "dst-address"],
  ["protocol", "protocol"],
  ["srcPort", "src-port"],
  ["dstPort", "dst-port"],
  ["inInterface", "in-interface"],
  ["outInterface", "out-interface"],
  ["inInterfaceList", "in-interface-list"],
  ["outInterfaceList", "out-interface-list"],
  ["srcAddressList", "src-address-list"],
  ["dstAddressList", "dst-address-list"],
  ["connectionState", "connection-state"],
  ["connectionNatState", "connection-nat-state"],
  ["srcAddressType", "src-address-type"],
  ["dstAddressType", "dst-address-type"],
  ["ipsecPolicy", "ipsec-policy"],
  ["packetMark", "packet-mark"],
  ["connectionMark", "connection-mark"],
  ["routingMark", "routing-mark"],
  ["toAddresses", "to-addresses"],
  ["toPorts", "to-ports"],
  ["newPacketMark", "new-packet-mark"],
  ["newConnectionMark", "new-connection-mark"],
  ["newRoutingMark", "new-routing-mark"],
  ["newTtl", "new-ttl"],
  ["passthrough", "passthrough"],
  ["comment", "comment"],
  ["disabled", "disabled"],
];
const KEY_BY_ROS = Object.fromEntries(ROS_NAMES.map(([k, r]) => [r, k])) as Record<string, RuleKey>;
/** RouterOS property name → rule field, e.g. "src-address" → "srcAddress" */
export const rosToRuleKey = (ros: string): RuleKey | undefined => KEY_BY_ROS[ros];
const ROS_BY_KEY = Object.fromEntries(ROS_NAMES) as Record<RuleKey, string>;

export const MATCHERS: RuleKey[] = [
  "srcAddress", "dstAddress", "protocol", "srcPort", "dstPort", "inInterface", "outInterface",
  "inInterfaceList", "outInterfaceList", "srcAddressList", "dstAddressList",
  "connectionState", "connectionNatState", "srcAddressType", "dstAddressType", "ipsecPolicy", "packetMark", "connectionMark", "routingMark",
];
export const BRIDGE_MATCHERS: RuleKey[] = ["srcAddress", "dstAddress", "protocol", "srcPort", "dstPort", "inInterface", "outInterface"];

export const matchersFor = (t: Table) => (t.startsWith("bridge") ? BRIDGE_MATCHERS : MATCHERS);

/** which action parameters apply to an action */
export function paramsFor(action: string): RuleKey[] {
  switch (action) {
    case "src-nat":
    case "dst-nat":
      return ["toAddresses", "toPorts"];
    case "masquerade":
    case "redirect":
      return ["toPorts"];
    case "mark-packet":
      return ["newPacketMark", "passthrough"];
    case "mark-connection":
      return ["newConnectionMark", "passthrough"];
    case "mark-routing":
      return ["newRoutingMark", "passthrough"];
    case "change-ttl":
      return ["newTtl", "passthrough"];
    default:
      return [];
  }
}

export const rosName = (k: RuleKey) => ROS_BY_KEY[k];

let seq = 0;
export const newId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

function quote(v: string) {
  return /[\s"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/** Rule → "chain=forward action=drop src-address=…" */
export function formatRule(r: Rule): string {
  const parts: string[] = [];
  for (const [k, ros] of ROS_NAMES) {
    const v = r[k];
    if (v === undefined || v === "" || k === "disabled") continue;
    if (k === "passthrough") {
      if (paramsFor(r.action).includes("passthrough")) parts.push(`passthrough=${v ? "yes" : "no"}`);
      continue;
    }
    parts.push(`${ros}=${quote(String(v))}`);
  }
  if (r.disabled) parts.push("disabled=yes");
  return parts.join(" ");
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /([^\s=]+)=("((?:[^"\\]|\\.)*)"|\S*)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[4]) out.push(m[4]);
    else out.push(`${m[1]}=${m[3] !== undefined ? m[3].replace(/\\"/g, '"') : m[2]}`);
  }
  return out;
}

/**
 * Parse one RouterOS command line, e.g.
 * `/ip firewall filter add chain=forward action=drop src-address=10.0.0.5`.
 * Returns the table (when the menu path is present) and the rule.
 */
export function parseRuleCommand(line: string, fallback: Table): { table: Table; rule: Rule } | { error: string } {
  let s = line.trim();
  if (!s) return { error: "Empty command" };
  let table = fallback;
  for (const [t, info] of Object.entries(TABLE_INFO) as [Table, (typeof TABLE_INFO)[Table]][]) {
    if (s.startsWith(info.menu)) {
      table = t;
      s = s.slice(info.menu.length).trim();
      break;
    }
  }
  const tokens = tokenize(s).filter((t) => t !== "add");
  const rule: Rule = { id: newId(), chain: "", action: "accept" };
  for (const tok of tokens) {
    const i = tok.indexOf("=");
    if (i < 0) return { error: `Unexpected "${tok}"` };
    const key = KEY_BY_ROS[tok.slice(0, i)];
    const val = tok.slice(i + 1);
    if (!key) return { error: `Unsupported property "${tok.slice(0, i)}"` };
    if (key === "passthrough" || key === "disabled") (rule[key] as boolean) = val === "yes" || val === "true";
    else (rule[key] as string) = val;
  }
  const info = TABLE_INFO[table];
  if (!info.chains.includes(rule.chain)) return { error: `chain must be one of: ${info.chains.join(", ")}` };
  if (!info.actions.includes(rule.action)) return { error: `action must be one of: ${info.actions.join(", ")}` };
  if (rule.action.startsWith("mark-") || rule.action === "change-ttl") rule.passthrough ??= true;
  return { table, rule };
}

/** Human-readable "if … then …" summary */
export function describeRule(r: Rule): string {
  const conds = MATCHERS.filter((k) => r[k]).map((k) => `${rosName(k)}=${r[k]}`);
  const params = paramsFor(r.action)
    .filter((k) => k !== "passthrough" && r[k])
    .map((k) => `${rosName(k)}=${r[k]}`);
  return `${conds.length ? conds.join(" ") : "any packet"} → ${r.action}${params.length ? " " + params.join(" ") : ""}`;
}
