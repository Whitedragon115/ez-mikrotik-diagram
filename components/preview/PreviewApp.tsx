"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSim } from "@/lib/store";
import { connectedNets, ifaceNet, inRange, isIp, parseRange, splitGateway } from "@/lib/sim/ip";
import { ROS_NAMES } from "@/lib/sim/rules";
import { toScript } from "@/lib/sim/nodes";
import type { ConnEntry, Iface, RouterConfig, Rule, Table } from "@/lib/sim/types";

/* ---------- icons (simple stroke icons, 24px grid) ---------- */

const ICON: Record<string, string> = {
  quickset: "M4 20 14 10M15 4v3M18 7h3M17 3l2 2M20 10l1 1",
  wifi: "M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01",
  interfaces: "M3 5h18v11H3zM7 20h10M12 16v4M7 9v3M11 9v3M15 9v3",
  wireguard: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  bridge: "M5 4v16M19 4v16M5 9h14M5 15h14",
  ppp: "M4 4h16v10H4zM8 20h8M12 14v6",
  ip: "M4 6v12M8 6h4a3 3 0 0 1 0 6H8M16 6l2 6 2-6",
  addresses: "M4 7h16M4 12h16M4 17h10",
  firewall: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8 11h8M8 15h8",
  ipsec: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3M12 15v2",
  routes: "M6 3v6a6 6 0 0 0 6 6h7M16 12l3 3-3 3",
  routing: "M4 20 20 4M14 4h6v6M4 4l6 6",
  tables: "M4 5h16v14H4zM4 10h16M10 5v14",
  system: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  queues: "M5 20V11M10 20V5M15 20v-6M20 20V8",
  files: "M3 6h6l2 2h10v11H3z",
  log: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
  terminal: "M3 5h18v14H3zM7 10l3 2-3 2M12 15h5",
  tools: "M14 6a4 4 0 0 0 5 5l-9 9-3-3z",
  chevron: "M9 6l6 6-6 6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  windows: "M8 4h12v12H8zM4 8v12h12",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  copy: "M8 8h12v12H8zM4 16V4h12",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  side: "M4 4h16v16H4zM15 4v16",
  router: "M3 13h18v6H3zM7 16h.01M11 16h.01M8 13l4-8 4 8",
  cpu: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  mem: "M4 8h16v8H4zM8 8v8M12 8v8M16 8v8",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  uptime: "M4 12a8 8 0 1 0 3-6.3M4 4v4h4",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  newIco: "M4 4h10v4M4 4v16h16V10M14 4l6 6M12 14h6M15 11v6",
};

function I({ n, size = 16, className }: { n: keyof typeof ICON; size?: number; className?: string }) {
  return (
    <svg className={className ? `wi ${className}` : "wi"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICON[n]} />
    </svg>
  );
}

/* ---------- generic table ---------- */

interface Col<T> {
  label: string;
  get: (r: T) => ReactNode;
  w?: number;
  text?: (r: T) => string;
}
interface Row<T> {
  key: string;
  data: T;
  flags?: string;
  comment?: string;
  disabled?: boolean;
}

function WbTable<T>({ cols, rows, onOpen, find, numbered, hideEmpty = true }: {
  cols: Col<T>[];
  rows: Row<T>[];
  onOpen?: (r: Row<T>) => void;
  find: string;
  numbered?: boolean;
  hideEmpty?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const q = find.trim().toLowerCase();
  const val = (c: Col<T>, d: T) => String(c.text?.(d) ?? c.get(d) ?? "");
  const shown = q ? rows.filter((r) => (r.comment ?? "").toLowerCase().includes(q) || cols.some((c) => val(c, r.data).toLowerCase().includes(q))) : rows;
  const visible = hideEmpty ? cols.filter((c, i) => i < 2 || rows.some((r) => val(c, r.data) !== "")) : cols;
  const hasComments = rows.some((r) => r.comment);
  return (
    <div className="w4-tablepane">
      <div className="w4-tablewrap">
        <table className="w4-table">
          <thead>
            <tr>
              <th className="w4-grip" />
              {numbered && <th className="w4-num">#<span className="w4-sort">▴</span></th>}
              <th className="w4-flag"><I n="flag" size={13} /></th>
              {hasComments && <th className="w4-comment-h">Comment</th>}
              {visible.map((c) => <th key={c.label} style={{ minWidth: c.w }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.key}
                className={[sel === r.key && "sel", r.disabled && "dis"].filter(Boolean).join(" ") || undefined}
                onClick={() => setSel(r.key)}
                onDoubleClick={() => onOpen?.(r)}
              >
                <td className="w4-grip">⠿</td>
                {numbered && <td className="w4-num">{rows.indexOf(r)}</td>}
                <td className="w4-flag">{r.disabled ? "X" : r.flags ?? ""}</td>
                {hasComments && <td className="w4-comment">{r.comment ?? ""}</td>}
                {visible.map((c) => <td key={c.label}>{c.get(r.data)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="w4-empty">{q ? "No items match the filter" : "No items"}</div>}
      </div>
      <div className="w4-foot">
        <span className="w4-count">{shown.length}<span className="w4-caret">⌄</span>{sel && shown.some((r) => r.key === sel) ? 1 : 0}</span>
        <span className="w4-live">▷ Live</span>
        {q && <span className="w4-dim">filtered from {rows.length}</span>}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

const ACTION_ICON: Record<string, [string, string]> = {
  accept: ["✓", "w-ok"], drop: ["✕", "w-bad"], reject: ["✕", "w-warn"], "fasttrack-connection": ["»", "w-fast"], log: ["≡", "w-dim"], passthrough: ["≡", "w-dim"],
  notrack: ["⊘", "w-warn"], masquerade: ["⇆", "w-nat"], "src-nat": ["⇆", "w-nat"], "dst-nat": ["⇆", "w-nat"], redirect: ["↩", "w-nat"],
  "mark-connection": ["✎", "w-mark"], "mark-packet": ["✎", "w-mark"], "mark-routing": ["✎", "w-mark"], "change-ttl": ["✎", "w-mark"],
};
const SHORT: Record<string, string> = { "fasttrack-connection": "fasttrack…", passthrough: "passt…", "mark-connection": "mark-conn…", "mark-packet": "mark-pack…", "mark-routing": "mark-rout…" };
const Action = ({ a }: { a: string }) => {
  const [icon, tone] = ACTION_ICON[a] ?? ["•", "w-dim"];
  return (
    <span className={`w4-act ${tone}`} title={a}>
      <i>{icon}</i>
      {SHORT[a] ?? a}
    </span>
  );
};
const MTU: Record<string, number> = { ether: 1500, bridge: 1500, vlan: 1500, gre: 1476, ipip: 1480, eoip: 1458 };
const TYPE_LABEL: Record<string, string> = { ether: "Ethernet", bridge: "Bridge", vlan: "VLAN", gre: "GRE Tunnel", ipip: "IPIP Tunnel", eoip: "EoIP Tunnel" };
const fakeMac = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ["48", "A9", "8A", ...[16, 8, 0].map((b) => ((h >>> b) & 255).toString(16).padStart(2, "0").toUpperCase())].join(":");
};
const v = (x?: string | number) => (x === undefined || x === "" ? "" : String(x));

function ruleCols(t: Table): Col<Rule>[] {
  const c = (label: string, k: keyof Rule, w?: number): Col<Rule> => ({ label, get: (r) => v(r[k] as string), w });
  const base: Col<Rule>[] = [{ label: "Action", get: (r) => <Action a={r.action} />, text: (r) => r.action, w: 104 }, c("Chain", "chain", 90)];
  const common = [c("Src. Address", "srcAddress", 120), c("Dst. Address", "dstAddress", 120), c("Protocol", "protocol"), c("Src. Port", "srcPort"), c("Dst. Port", "dstPort"), c("In. Interface", "inInterface"), c("Out. Interface", "outInterface")];
  const lists = [c("In. Interface List", "inInterfaceList"), c("Out. Interface List", "outInterfaceList"), c("Src. Address List", "srcAddressList"), c("Dst. Address List", "dstAddressList")];
  const extra: Record<Table, Col<Rule>[]> = {
    filter: [c("Connection State", "connectionState", 140), c("Connection NAT State", "connectionNatState")],
    nat: [c("To Addresses", "toAddresses", 120), c("To Ports", "toPorts")],
    mangle: [
      c("Connection Mark", "connectionMark"), c("Packet Mark", "packetMark"), c("Routing Mark", "routingMark"), c("Connection State", "connectionState"),
      c("New Connection Mark", "newConnectionMark"), c("New Packet Mark", "newPacketMark"), c("New Routing Mark", "newRoutingMark"),
      { label: "Passthrough", get: (r) => (r.action.startsWith("mark") || r.action === "change-ttl" ? (r.passthrough === false ? "no" : "yes") : "") },
    ],
    raw: [],
    "bridge-filter": [],
    "bridge-nat": [],
  };
  return [...base, ...common, ...(t.startsWith("bridge") ? [] : lists), ...extra[t]];
}

/* ---------- windows ---------- */

type WinId = "interfaces" | "bridge" | "addresses" | "routes" | "firewall" | "ipsec" | "tables" | "queues" | "terminal";

interface MenuItem {
  label: string;
  icon: keyof typeof ICON;
  id?: WinId;
  children?: { label: string; id: WinId; icon: keyof typeof ICON }[];
  off?: boolean;
}

const MENU: MenuItem[] = [
  { label: "Quick Set", icon: "quickset", off: true },
  { label: "WiFi", icon: "wifi", off: true },
  { label: "Interfaces", icon: "interfaces", id: "interfaces" },
  { label: "WireGuard", icon: "wireguard", off: true },
  { label: "Bridge", icon: "bridge", id: "bridge" },
  { label: "PPP", icon: "ppp", off: true },
  {
    label: "IP", icon: "ip",
    children: [
      { label: "Addresses", id: "addresses", icon: "addresses" },
      { label: "Firewall", id: "firewall", icon: "firewall" },
      { label: "IPsec", id: "ipsec", icon: "ipsec" },
      { label: "Routes", id: "routes", icon: "routes" },
    ],
  },
  { label: "Routing", icon: "routing", children: [{ label: "Tables", id: "tables", icon: "tables" }] },
  { label: "System", icon: "system", off: true },
  { label: "Queues", icon: "queues", id: "queues" },
  { label: "Files", icon: "files", off: true },
  { label: "Log", icon: "log", off: true },
  { label: "New Terminal", icon: "terminal", id: "terminal" },
  { label: "Tools", icon: "tools", off: true },
];

const TITLES: Record<WinId, [string, keyof typeof ICON]> = {
  interfaces: ["Interfaces", "interfaces"], bridge: ["Bridge", "bridge"], addresses: ["Addresses", "addresses"], routes: ["Routes", "routes"],
  firewall: ["Firewall", "firewall"], ipsec: ["IPsec", "ipsec"], tables: ["Tables", "tables"], queues: ["Queues", "queues"], terminal: ["Terminal", "terminal"],
};

const TABS: Partial<Record<WinId, string[]>> = {
  interfaces: ["Interface", "Interface List"],
  bridge: ["Bridge", "Ports", "Filters", "NAT", "Hosts"],
  firewall: ["Filter Rules", "NAT", "Mangle", "Raw", "Connections", "Address Lists"],
  ipsec: ["Policies", "Peers"],
  queues: ["Simple Queues", "Queue Tree"],
};

interface Props {
  cfg: RouterConfig;
  hits: Record<string, number>;
  conntrack: ConnEntry[];
  find: string;
  tab: number;
  open: (title: string, fields: [string, string][]) => void;
}

const ruleFields = (r: Rule): [string, string][] =>
  ROS_NAMES.filter(([k]) => r[k] !== undefined && r[k] !== "").map(([k, ros]) => [ros, typeof r[k] === "boolean" ? (r[k] ? "yes" : "no") : String(r[k])]);

function RuleTable({ cfg, hits, table, find, open, title }: Props & { table: Table; title: string }) {
  const rows: Row<Rule>[] = cfg.rules[table].map((r) => ({ key: r.id, data: r, comment: r.comment, disabled: r.disabled }));
  const cols = [...ruleCols(table), { label: "Packets", get: (r: Rule) => String(hits[r.id] ?? 0) }];
  return <WbTable cols={cols} rows={rows} find={find} numbered onOpen={(r) => open(`${title} <${r.data.chain}>`, ruleFields(r.data))} />;
}

function Content(p: Props & { win: WinId }) {
  const { cfg, conntrack, find, open, tab, win } = p;
  const ep = (ip: string, port: number) => (port ? `${ip}:${port}` : ip);

  if (win === "interfaces") {
    if (tab === 1) {
      const rows = cfg.interfaceLists.flatMap((l) => l.members.split(",").filter(Boolean).map((m) => ({ key: l.name + m, data: { list: l.name, iface: m.trim() } })));
      return <WbTable cols={[{ label: "List", get: (x) => x.list, w: 110 }, { label: "Interface", get: (x) => x.iface, w: 130 }]} rows={rows} find={find} numbered hideEmpty={false} />;
    }
    const rows: Row<Iface>[] = cfg.interfaces.map((i) => ({ key: i.name, data: i, comment: i.comment, disabled: i.disabled, flags: i.bridge ? "RS" : "R" }));
    return (
      <WbTable
        cols={[
          { label: "Name", get: (i) => i.name, w: 130 },
          { label: "Type", get: (i) => TYPE_LABEL[i.type], w: 100 },
          { label: "Actual MTU", get: (i) => String(MTU[i.type]) },
          { label: "MAC Address", get: (i) => (["ether", "bridge", "eoip"].includes(i.type) ? fakeMac(i.name) : ""), w: 140 },
          { label: "Tx", get: () => "0 bps" },
          { label: "Rx", get: () => "0 bps" },
        ]}
        rows={rows}
        find={find}
        hideEmpty={false}
        onOpen={(r) => open(`Interface <${r.data.name}>`, Object.entries(r.data).map(([k, x]) => [k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(x)]))}
      />
    );
  }

  if (win === "bridge") {
    if (tab === 0)
      return (
        <WbTable
          cols={[{ label: "Name", get: (i) => i.name, w: 120 }, { label: "Type", get: () => "Bridge" }, { label: "MTU", get: () => "auto" }, { label: "MAC Address", get: (i) => fakeMac(i.name), w: 140 }, { label: "Use IP Firewall", get: () => (cfg.bridge.useIpFirewall ? "yes" : "no") }]}
          rows={cfg.interfaces.filter((i) => i.type === "bridge").map((b) => ({ key: b.name, data: b, comment: b.comment, flags: "R", disabled: b.disabled }))}
          find={find}
          hideEmpty={false}
          onOpen={() => open("Bridge Settings", [["use-ip-firewall", cfg.bridge.useIpFirewall ? "yes" : "no"], ["use-ip-firewall-for-vlan", "no"], ["allow-fast-path", "yes"]])}
        />
      );
    if (tab === 1)
      return (
        <WbTable
          cols={[{ label: "Interface", get: (i) => i.name, w: 110 }, { label: "Bridge", get: (i) => i.bridge ?? "", w: 90 }, { label: "Horizon", get: () => "" }, { label: "PVID", get: () => "1" }, { label: "Role", get: () => "designated port", w: 120 }]}
          rows={cfg.interfaces.filter((i) => i.bridge).map((i) => ({ key: i.name, data: i, disabled: i.disabled }))}
          find={find}
          numbered
          hideEmpty={false}
        />
      );
    if (tab === 2) return <RuleTable {...p} table="bridge-filter" title="Bridge Filter Rule" />;
    if (tab === 3) return <RuleTable {...p} table="bridge-nat" title="Bridge NAT Rule" />;
    return (
      <WbTable
        cols={[{ label: "MAC Address", get: (h) => fakeMac(h.ip), w: 140 }, { label: "On Interface", get: (h) => h.port }, { label: "Bridge", get: (h) => h.bridge }, { label: "IP (simulated)", get: (h) => h.ip, w: 120 }]}
        rows={cfg.bridgeHosts.map((h, i) => ({ key: String(i), data: h, flags: "D" }))}
        find={find}
        hideEmpty={false}
      />
    );
  }

  if (win === "firewall") {
    if (tab === 0) return <RuleTable {...p} table="filter" title="Firewall Rule" />;
    if (tab === 1) return <RuleTable {...p} table="nat" title="NAT Rule" />;
    if (tab === 2) return <RuleTable {...p} table="mangle" title="Mangle Rule" />;
    if (tab === 3) return <RuleTable {...p} table="raw" title="Raw Rule" />;
    if (tab === 4)
      return (
        <WbTable
          cols={[
            { label: "Src. Address", get: (c) => ep(c.orig.src, c.orig.sport), w: 150 },
            { label: "Dst. Address", get: (c) => ep(c.orig.dst, c.orig.dport), w: 150 },
            { label: "Reply Src. Address", get: (c) => ep(c.reply.src, c.reply.sport), w: 150 },
            { label: "Reply Dst. Address", get: (c) => ep(c.reply.dst, c.reply.dport), w: 150 },
            { label: "Protocol", get: (c) => c.proto },
            { label: "Connection Mark", get: (c) => c.connMark ?? "" },
            { label: "TCP State", get: (c) => (c.proto === "tcp" ? (c.seenReply ? "established" : "syn-sent") : "") },
            { label: "Orig. Packets", get: (c) => String(c.packets) },
          ]}
          rows={conntrack.map((c) => ({ key: String(c.id), data: c, flags: ["C", c.seenReply && "SA", c.snat && "s", c.dnat && "d"].filter(Boolean).join("") }))}
          find={find}
        />
      );
    return (
      <WbTable
        cols={[{ label: "Name", get: (a) => a.list, w: 120 }, { label: "Address", get: (a) => a.address, w: 140 }, { label: "Timeout", get: () => "" }]}
        rows={cfg.addressLists.map((a, i) => ({ key: String(i), data: a }))}
        find={find}
        hideEmpty={false}
      />
    );
  }

  if (win === "routes") return <RoutesTable {...p} />;

  if (win === "addresses")
    return (
      <WbTable
        cols={[{ label: "Address", get: (a) => a.address, w: 150 }, { label: "Network", get: (a) => ifaceNet(a.address)?.network.split("/")[0] ?? "", w: 120 }, { label: "Interface", get: (a) => a.interface, w: 120 }]}
        rows={cfg.addresses.map((a, i) => ({ key: String(i), data: a, disabled: a.disabled }))}
        find={find}
        numbered
        hideEmpty={false}
      />
    );

  if (win === "ipsec")
    return tab === 0 ? (
      <WbTable
        cols={[
          { label: "Src. Address", get: (x) => x.src, w: 130 }, { label: "Dst. Address", get: (x) => x.dst, w: 130 }, { label: "Protocol", get: () => "all" },
          { label: "Action", get: (x) => x.action }, { label: "Level", get: () => "require" }, { label: "Tunnel", get: () => "yes" },
          { label: "SA Src. Address", get: (x) => x.saSrc, w: 130 }, { label: "SA Dst. Address", get: (x) => x.saDst, w: 130 },
        ]}
        rows={cfg.ipsecPolicies.map((x, i) => ({ key: String(i), data: x, disabled: x.disabled, flags: "A" }))}
        find={find}
        numbered
        hideEmpty={false}
      />
    ) : (
      <WbTable
        cols={[{ label: "Name", get: (x) => `peer-${x.saDst}`, w: 150 }, { label: "Address", get: (x) => x.saDst, w: 130 }, { label: "Local Address", get: (x) => x.saSrc, w: 130 }, { label: "Exchange Mode", get: () => "IKE2" }]}
        rows={[...new Map(cfg.ipsecPolicies.map((x) => [x.saDst, x])).values()].map((x) => ({ key: x.saDst, data: x }))}
        find={find}
        hideEmpty={false}
      />
    );

  if (win === "tables")
    return (
      <WbTable
        cols={[{ label: "Name", get: (t) => t, w: 150 }, { label: "FIB", get: () => "yes" }]}
        rows={[...new Set(["main", ...cfg.routes.map((r) => r.table)])].map((t) => ({ key: t, data: t, flags: t === "main" ? "D" : "" }))}
        find={find}
        hideEmpty={false}
      />
    );

  if (win === "queues")
    return tab === 0 ? (
      <WbTable
        cols={[{ label: "Name", get: (q) => q.name, w: 120 }, { label: "Target", get: (q) => q.target, w: 140 }, { label: "Upload Max Limit", get: (q) => q.maxLimit.split("/")[0] ?? "" }, { label: "Download Max Limit", get: (q) => q.maxLimit.split("/")[1] ?? "" }]}
        rows={cfg.simpleQueues.map((q, i) => ({ key: String(i), data: q, disabled: q.disabled }))}
        find={find}
        numbered
        hideEmpty={false}
      />
    ) : (
      <WbTable
        cols={[{ label: "Name", get: (q) => q.name, w: 120 }, { label: "Parent", get: (q) => q.parent }, { label: "Packet Marks", get: (q) => q.packetMark }, { label: "Max Limit", get: (q) => q.maxLimit }]}
        rows={cfg.queueTrees.map((q, i) => ({ key: String(i), data: q, disabled: q.disabled }))}
        find={find}
        hideEmpty={false}
      />
    );

  return <Terminal cfg={cfg} />;
}

function RoutesTable({ cfg, find, open }: Props) {
  const rows = useMemo(() => {
    const up = cfg.addresses.filter((a) => !a.disabled && cfg.interfaces.some((i) => i.name === a.interface && !i.disabled));
    const connected = up.map((a) => ({ dst: ifaceNet(a.address)?.network ?? "", gateway: a.interface, distance: 0, table: "main", flags: "DAc", comment: undefined as string | undefined, disabled: false }));
    const reach = (gw: string) => {
      const g = splitGateway(gw);
      if (g.iface) return cfg.interfaces.some((i) => i.name === g.iface && !i.disabled);
      return !!g.ip && up.some((a) => connectedNets(a).some((net) => inRange(g.ip!, net)));
    };
    const statics = cfg.routes.map((r) => ({ ...r, flags: r.disabled ? "" : reach(r.gateway) ? "As" : "s" }));
    return [...statics, ...connected]
      .sort((a, b) => (parseRange(a.dst)?.lo ?? 0) - (parseRange(b.dst)?.lo ?? 0))
      .map((r, i) => ({ key: String(i), data: r, flags: r.flags, comment: r.comment, disabled: r.disabled }));
  }, [cfg]);
  return (
    <WbTable
      cols={[
        { label: "Dst. Address", get: (r) => r.dst, w: 130 },
        { label: "Gateway", get: (r) => r.gateway, w: 130 },
        { label: "Distance", get: (r) => String(r.distance) },
        { label: "Routing Table", get: (r) => r.table, w: 110 },
      ]}
      rows={rows}
      find={find}
      hideEmpty={false}
      onOpen={(r) => open("Route", [["dst-address", r.data.dst], ["gateway", r.data.gateway], ["distance", String(r.data.distance)], ["routing-table", r.data.table]])}
    />
  );
}

function Terminal({ cfg }: { cfg: RouterConfig }) {
  const lines = toScript(cfg).split("\n");
  const color = (l: string) => {
    if (l.startsWith("#")) return <span className="t-com">{l}</span>;
    if (l.startsWith("/")) return <span className="t-path">{l}</span>;
    return (l.match(/[\w-]+="[^"]*"|\S+|\s+/g) ?? []).map((tok, i) => {
      const m = tok.match(/^([\w-]+)=(.*)$/);
      if (m) return <span key={i}><span className="t-key">{m[1]}</span>=<span className="t-val">{m[2]}</span></span>;
      if (tok === "add" || tok === "set") return <span key={i} className="t-cmd">{tok}</span>;
      return tok;
    });
  };
  return (
    <div className="w4-term">
      <div className="t-dim">RouterOS packet-flow simulator · configuration export (read-only)</div>
      <br />
      <div><span className="t-prompt">[admin@{cfg.identity}] &gt; </span>/export</div>
      {lines.map((l, i) => <div key={i}>{color(l)}</div>)}
      <div><span className="t-prompt">[admin@{cfg.identity}] &gt; </span><span className="t-cursor">█</span></div>
    </div>
  );
}

/* ---------- app ---------- */

const RSC_WARNING = [
  "This export is meant for re-importing into the simulator website.",
  "",
  "Don't paste or /import it into a real MikroTik router. It only contains what the simulator models and can break connectivity or lock you out.",
  "",
  "Continue?",
].join("\n");

function download(name: string, text: string, type: string) {
  if (name.endsWith(".rsc") && !window.confirm(RSC_WARNING)) return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${d.toLocaleTimeString([], { hour12: false })}`;

export default function PreviewApp() {
  const cfg = useSim((s) => s.cfg);
  const hits = useSim((s) => s.hits);
  const conntrack = useSim((s) => s.conntrack);
  const [win, setWin] = useState<WinId>("firewall");
  const [tab, setTab] = useState(0);
  const [expanded, setExpanded] = useState<string | null>("IP");
  const [find, setFind] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [actions, setActions] = useState(true);
  const [dialog, setDialog] = useState<{ title: string; fields: [string, string][] } | null>(null);
  const [copied, setCopied] = useState(false);
  const now = useClock();
  const [opened] = useState(() => Date.now());

  // live-update when the simulator tab changes the config
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === "ros-packet-sim-v1") useSim.persist.rehydrate();
    };
    window.addEventListener("storage", on);
    document.title = `admin@${cfg.identity} — Config Preview`;
    return () => window.removeEventListener("storage", on);
  }, [cfg.identity]);

  const wan = cfg.addresses[0]?.address.split("/")[0] ?? "0.0.0.0";
  const props: Props = { cfg, hits, conntrack, find, tab, open: (title, fields) => setDialog({ title, fields }) };
  const choose = (id: WinId) => {
    setWin(id);
    setTab(0);
    setFind("");
  };
  const up = Math.floor((now.getTime() - opened) / 1000);
  const uptime = `${Math.floor(up / 3600)}h${String(Math.floor((up % 3600) / 60)).padStart(2, "0")}m${String(up % 60).padStart(2, "0")}s`;
  const totalRules = Object.values(cfg.rules).reduce((n, r) => n + r.length, 0);
  const [title, titleIcon] = TITLES[win];
  const tabs = TABS[win];

  const copy = async () => {
    if (!window.confirm(RSC_WARNING)) return;
    await navigator.clipboard?.writeText(toScript(cfg));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="w4">
      <header className="w4-top">
        <div className="w4-brand"><I n="router" size={20} /><span>{cfg.identity}</span></div>
        <div className="w4-ws">
          <span className="w4-dim">Workspace:</span>
          <span className="w4-select">&lt;own&gt;<span className="w4-caret">⌄</span></span>
          <span className="w4-ico-btn" title="Open windows"><I n="windows" /> 1</span>
          <button className="w4-ico-btn" title="Find" onClick={() => setShowFind(!showFind)}><I n="search" /></button>
        </div>
        <span className="sp" />
        <span className="w4-badge" title="This page shows the simulator's configuration; nothing here changes a real router">Read-only preview</span>
        <span className="w4-ico-btn off" title="Undo (read-only)"><I n="undo" /></span>
        <span className="w4-ico-btn off" title="Redo (read-only)"><I n="redo" /></span>
        <span className="w4-safe off">Safe Mode</span>
        <button className="w4-ico-btn" title="Download .rsc script" onClick={() => download(`${cfg.identity}.rsc`, toScript(cfg), "text/plain")}><I n="download" /> .rsc</button>
        <button className="w4-ico-btn" title="Download JSON" onClick={() => download(`${cfg.identity}.json`, JSON.stringify(cfg, null, 2), "application/json")}><I n="download" /> JSON</button>
        <button className="w4-ico-btn" title="Copy script" onClick={copy}><I n="copy" /> {copied ? "Copied" : "Copy"}</button>
        <button className="w4-ico-btn" title="Print" onClick={() => window.print()}><I n="print" /></button>
      </header>

      <div className="w4-body">
        <nav className="w4-nav">
          {MENU.map((m) =>
            m.children ? (
              <div key={m.label}>
                <button className={m.children.some((c) => c.id === win) ? "w4-mi parent" : "w4-mi"} onClick={() => setExpanded(expanded === m.label ? null : m.label)}>
                  <I n={m.icon} size={18} />
                  <span>{m.label}</span>
                  <I n="chevron" size={14} className={expanded === m.label ? "w4-chev open" : "w4-chev"} />
                </button>
                {expanded === m.label &&
                  m.children.map((c) => (
                    <button key={c.id} className={win === c.id ? "w4-mi sub on" : "w4-mi sub"} onClick={() => choose(c.id)}>
                      <I n={c.icon} size={16} />
                      <span>{c.label}</span>
                    </button>
                  ))}
              </div>
            ) : (
              <button
                key={m.label}
                className={[win === m.id && "on", m.off && "off", "w4-mi"].filter(Boolean).join(" ")}
                onClick={() => m.id && choose(m.id)}
                title={m.off ? "Not part of the simulation" : undefined}
              >
                <I n={m.icon} size={18} />
                <span>{m.label}</span>
              </button>
            ),
          )}
        </nav>

        <main className="w4-main">
          <div className="w4-tabbar">
            <div className="w4-wintitle"><I n={titleIcon} size={18} /><span>{title}</span><span className="w4-caret">⌄</span></div>
            {tabs?.map((t, i) => (
              <button key={t} className={i === tab ? "w4-tab on" : "w4-tab"} onClick={() => { setTab(i); setFind(""); }}>{t}</button>
            ))}
            <span className="sp" />
          </div>

          {win !== "terminal" && (
            <div className="w4-toolbar">
              <span className="w4-tool off"><I n="newIco" size={15} />New</span>
              <span className="w4-tool off"><i className="sq w-ok">▶</i>Enable</span>
              <span className="w4-tool off"><i className="sq w-dim">❚❚</i>Disable</span>
              <span className="w4-tool off"><i className="sq w-bad">✕</i>Remove</span>
              <span className="w4-tool off"><I n="flag" size={14} />Comment</span>
              <span className="sp" />
              {showFind || find ? (
                <input className="w4-find" autoFocus placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
              ) : (
                <button className="w4-tool" onClick={() => setShowFind(true)}><I n="search" size={14} />Find</button>
              )}
              <span className="w4-tool off"><I n="filter" size={14} />Filter</span>
              <span className="w4-tool off">all<span className="w4-caret">⌄</span></span>
              <button className={actions ? "w4-tool on" : "w4-tool"} onClick={() => setActions(!actions)} title="Actions panel"><I n="side" size={15} /></button>
            </div>
          )}

          <div className="w4-work">
            <div className="w4-content">
              <Content {...props} win={win} />
            </div>
            {actions && win !== "terminal" && (
              <aside className="w4-actions">
                <div className="w4-actions-h">⚡ Actions</div>
                {win === "firewall" && tab < 4 && <span className="w4-action off">Reset Counters</span>}
                {win === "firewall" && tab < 4 && <span className="w4-action off">Reset All Counters</span>}
                <button className="w4-action" onClick={() => choose("terminal")}>Export…</button>
                <button className="w4-action" onClick={() => download(`${cfg.identity}.rsc`, toScript(cfg), "text/plain")}>Download script</button>
              </aside>
            )}
          </div>
        </main>
      </div>

      <footer className="w4-status">
        <span><I n="router" size={15} /> <b>{cfg.identity}</b> {wan} / simulated / RouterOS model / packet-flow simulator</span>
        <span><I n="cpu" size={15} /> 1 %</span>
        <span><I n="mem" size={15} /> {cfg.interfaces.length} interfaces · {totalRules} rules · {conntrack.length} connections</span>
        <span><I n="uptime" size={15} /> {uptime}</span>
        <span><I n="clock" size={15} /> {fmtDate(now)}</span>
      </footer>

      {dialog && (
        <div className="w4-modal" onClick={() => setDialog(null)}>
          <div className="w4-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={dialog.title}>
            <div className="w4-dialog-title"><span>{dialog.title}</span><span className="sp" /><button className="w4-x" onClick={() => setDialog(null)}>✕</button></div>
            <div className="w4-dialog-body">
              <div className="w4-fields">
                <div className="w4-subtab">General</div>
                {dialog.fields.map(([k, val]) => (
                  <label key={k}>
                    <span>{k.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                    <input readOnly value={val} />
                  </label>
                ))}
              </div>
              <div className="w4-dialog-side">
                <button className="w4-btn primary" onClick={() => setDialog(null)}>OK</button>
                <button className="w4-btn" onClick={() => setDialog(null)}>Cancel</button>
                <button className="w4-btn" disabled>Apply</button>
                <button className="w4-btn" disabled>Disable</button>
                <button className="w4-btn" disabled>Copy</button>
                <button className="w4-btn" disabled>Remove</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
