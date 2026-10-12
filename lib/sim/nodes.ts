// Which configuration each diagram node exposes in the inspector.
import type { RouterConfig, Table } from "./types";
import { formatRule } from "./rules";

export interface RuleTab {
  table: Table;
  chain: string;
  label: string;
}

export type Editor =
  | { kind: "rules"; tabs: RuleTab[]; queues?: boolean }
  | { kind: "routes" }
  | { kind: "ipsec" }
  | { kind: "bridgeHosts" }
  | { kind: "bridgePorts" }
  | { kind: "ipfw" }
  | { kind: "tunnels" }
  | { kind: "ifaceQueues" }
  | { kind: "packet" }
  | { kind: "addresses" }
  | { kind: "mpls" }
  | { kind: "info" };

const PRE: RuleTab[] = [
  { table: "raw", chain: "prerouting", label: "Raw" },
  { table: "mangle", chain: "prerouting", label: "Mangle" },
  { table: "nat", chain: "dstnat", label: "DST-NAT" },
];
const INPUT: RuleTab[] = [
  { table: "mangle", chain: "input", label: "Mangle" },
  { table: "filter", chain: "input", label: "Filter" },
];
const FORWARD: RuleTab[] = [
  { table: "mangle", chain: "forward", label: "Mangle" },
  { table: "filter", chain: "forward", label: "Filter" },
];
const OUTPUT: RuleTab[] = [
  { table: "raw", chain: "output", label: "Raw" },
  { table: "mangle", chain: "output", label: "Mangle" },
  { table: "filter", chain: "output", label: "Filter" },
];
const POST: RuleTab[] = [
  { table: "mangle", chain: "postrouting", label: "Mangle" },
  { table: "nat", chain: "srcnat", label: "SRC-NAT" },
];

export const NODE_EDITOR: Record<string, Editor> = {
  in_phys: { kind: "packet" },
  in_log: { kind: "tunnels" },
  q_inbr: { kind: "bridgePorts" },
  br_dstnat: { kind: "rules", tabs: [{ table: "bridge-nat", chain: "dstnat", label: "Bridge NAT" }] },
  br_ipfw1: { kind: "ipfw" },
  br_ipfw2: { kind: "ipfw" },
  br_ipfw3: { kind: "ipfw" },
  br_pre: { kind: "rules", tabs: PRE },
  br_decision: { kind: "bridgeHosts" },
  br_decision_out: { kind: "bridgeHosts" },
  br_input: { kind: "rules", tabs: [{ table: "bridge-filter", chain: "input", label: "Bridge filter" }] },
  br_forward: { kind: "rules", tabs: [{ table: "bridge-filter", chain: "forward", label: "Bridge filter" }] },
  br_output: { kind: "rules", tabs: [{ table: "bridge-filter", chain: "output", label: "Bridge filter" }] },
  br_fwd: { kind: "rules", tabs: FORWARD },
  br_srcnat: { kind: "rules", tabs: [{ table: "bridge-nat", chain: "srcnat", label: "Bridge NAT" }] },
  br_post: { kind: "rules", tabs: POST, queues: true },
  r_pre: { kind: "rules", tabs: PRE },
  r_input: { kind: "rules", tabs: INPUT, queues: true },
  r_forward: { kind: "rules", tabs: FORWARD },
  r_output: { kind: "rules", tabs: OUTPUT },
  r_post: { kind: "rules", tabs: POST, queues: true },
  rd_in: { kind: "routes" },
  rd_out: { kind: "routes" },
  ipsec_in: { kind: "ipsec" },
  ipsec_out: { kind: "ipsec" },
  r_decrypt: { kind: "ipsec" },
  r_encrypt: { kind: "ipsec" },
  q_decap: { kind: "tunnels" },
  decapsulation: { kind: "tunnels" },
  q_encap: { kind: "tunnels" },
  encapsulation: { kind: "tunnels" },
  log_out: { kind: "tunnels" },
  htb1: { kind: "ifaceQueues" },
  htb2: { kind: "ifaceQueues" },
  q_outbr: { kind: "bridgePorts" },
  local_in: { kind: "addresses" },
  local_out: { kind: "addresses" },
  proc: { kind: "addresses" },
  q_ip_in: { kind: "info" },
  q_ip_out: { kind: "info" },
  out_phys: { kind: "info" },
  q_mpls_in: { kind: "mpls" },
  q_mpls_out: { kind: "mpls" },
  dec_in: { kind: "mpls" },
  pop: { kind: "mpls" },
  vpls: { kind: "mpls" },
  portal_decap: { kind: "mpls" },
  switch: { kind: "mpls" },
  dec_out: { kind: "mpls" },
  push: { kind: "mpls" },
  portal_g: { kind: "mpls" },
};

export const MPLS_NODES = new Set(Object.entries(NODE_EDITOR).filter(([, e]) => e.kind === "mpls").map(([k]) => k));

/** Number of configured (enabled) items behind a node, shown as a chip on the canvas. */
export function nodeCount(cfg: RouterConfig, id: string): number {
  const e = NODE_EDITOR[id];
  if (!e) return 0;
  switch (e.kind) {
    case "rules":
      return e.tabs.reduce((n, t) => n + cfg.rules[t.table].filter((r) => r.chain === t.chain && !r.disabled).length, 0);
    case "routes":
      return cfg.routes.filter((r) => !r.disabled).length;
    case "ipsec":
      return cfg.ipsecPolicies.filter((p) => !p.disabled).length;
    case "bridgeHosts":
      return cfg.bridgeHosts.length;
    default:
      return 0;
  }
}

/** Export the configuration as a RouterOS script. */
export function toScript(cfg: RouterConfig): string {
  const L: string[] = [
    `# ${cfg.identity} — exported from the RouterOS packet-flow simulator`,
    "#",
    "# WARNING: DO NOT paste or /import this into a real MikroTik router.",
    "# This file is meant for importing back into the simulator website. The syntax is",
    "# RouterOS-compatible, but it only contains what the simulator models (no DHCP, DNS,",
    "# users, services, wireless, MAC addresses…) and may include placeholder addresses.",
    "# Running it on a live router can break connectivity or lock you out.",
    "#",
  ];
  const q = (v: string | number) => (/[\s"]/.test(String(v)) ? `"${v}"` : String(v));
  const kv = (o: Record<string, string | number | undefined | boolean>) =>
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== "" && v !== false)
      .map(([k, v]) => `${k}=${v === true ? "yes" : q(v as string)}`)
      .join(" ");
  const ifs = cfg.interfaces;
  const sec = (title: string, lines: string[]) => lines.length && L.push(title, ...lines);
  sec("/interface bridge", ifs.filter((i) => i.type === "bridge").map((i) => `add ${kv({ name: i.name, comment: i.comment })}`));
  sec("/interface vlan", ifs.filter((i) => i.type === "vlan").map((i) => `add ${kv({ name: i.name, "vlan-id": i.vlanId, interface: i.parent, comment: i.comment })}`));
  for (const t of ["gre", "ipip", "eoip"] as const)
    sec(`/interface ${t}`, ifs.filter((i) => i.type === t).map((i) => `add ${kv({ name: i.name, "local-address": i.local, "remote-address": i.remote, comment: i.comment })}`));
  sec("/interface bridge port", ifs.filter((i) => i.bridge).map((i) => `add ${kv({ bridge: i.bridge, interface: i.name })}`));
  sec("/interface bridge settings", [`set use-ip-firewall=${cfg.bridge.useIpFirewall ? "yes" : "no"}`]);
  sec("/interface list", cfg.interfaceLists.map((l) => `add name=${q(l.name)}`));
  sec("/interface list member", cfg.interfaceLists.flatMap((l) => l.members.split(",").filter(Boolean).map((m) => `add list=${q(l.name)} interface=${q(m.trim())}`)));
  sec("/ip address", cfg.addresses.map((a) => `add ${kv({ address: a.address, interface: a.interface, disabled: a.disabled })}`));
  const tables = [...new Set(cfg.routes.map((r) => r.table).filter((t) => t !== "main"))];
  sec("/routing table", tables.map((t) => `add name=${q(t)} fib`));
  sec("/ip route", cfg.routes.map((r) => `add ${kv({ "dst-address": r.dst, gateway: r.gateway, distance: r.distance, "routing-table": r.table === "main" ? undefined : r.table, comment: r.comment, disabled: r.disabled })}`));
  sec("/ip firewall address-list", cfg.addressLists.map((a) => `add list=${q(a.list)} address=${a.address}`));
  const menus: [string, keyof RouterConfig["rules"]][] = [
    ["/ip firewall raw", "raw"], ["/ip firewall mangle", "mangle"], ["/ip firewall nat", "nat"], ["/ip firewall filter", "filter"],
    ["/interface bridge filter", "bridge-filter"], ["/interface bridge nat", "bridge-nat"],
  ];
  for (const [menu, t] of menus) sec(menu, cfg.rules[t].map((r) => `add ${formatRule(r)}`));
  sec("/ip ipsec policy", cfg.ipsecPolicies.map((p) => `add ${kv({ "src-address": p.src, "dst-address": p.dst, action: p.action, tunnel: true, "sa-src-address": p.saSrc, "sa-dst-address": p.saDst, disabled: p.disabled })}`));
  sec("/queue simple", cfg.simpleQueues.map((s) => `add ${kv({ name: s.name, target: s.target, "max-limit": s.maxLimit, disabled: s.disabled })}`));
  sec("/queue tree", cfg.queueTrees.map((s) => `add ${kv({ name: s.name, parent: s.parent, "packet-mark": s.packetMark, "max-limit": s.maxLimit, disabled: s.disabled })}`));
  return L.join("\n") + "\n";
}
