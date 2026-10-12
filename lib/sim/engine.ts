// Packet-flow simulator: walks one packet through the RouterOS packet-flow graph,
// evaluating the configured rules at every hook and recording a step-by-step trace.
import { inRange, ifaceNet, isIp, neg, parsePort, parseRange, portMatch, intToIp } from "./ip";
import { rosName, type RuleKey } from "./rules";
import type {
  ConnEntry, ConnState, Iface, PacketInput, Pkt, PktSnap, RouterConfig, RoutingRule, Rule, RuleEval, SimResult,
  StageResult, Table, TraceStep, Tuple,
} from "./types";

const MAX_STEPS = 400;
const PROTO_NUM: Record<string, string> = { "1": "icmp", "4": "ipip", "6": "tcp", "17": "udp", "47": "gre", "50": "esp" };
const TUNNEL_TYPES = ["vlan", "gre", "ipip", "eoip"];

class Drop extends Error {}

interface Ctx {
  inIface?: string;
  inPort?: string;
  outIface?: string;
  outPort?: string;
  nextHop?: string;
  conn?: ConnEntry;
  pending?: boolean;
  confirmed?: boolean;
  dir?: "orig" | "reply";
  connState?: ConnState;
  untracked?: boolean;
  natDone?: { dstnat?: boolean; srcnat?: boolean };
  lookupMark?: string;
  internet?: boolean;
  /** packet came out of IPsec decryption */
  fromIpsec?: boolean;
}

interface RouteHit {
  iface: string;
  nextHop: string;
  desc: string;
  /** matched the default route (0.0.0.0/0): the packet heads to "the Internet" */
  internet?: boolean;
}

type RouteResult = { hit: RouteHit; notes: string[] } | { drop: string; notes: string[] };

/** "src-address=… action=lookup table=…" as RouterOS would print it */
export function describeRoutingRule(r: RoutingRule): string {
  const parts = [
    r.srcAddress && `src-address=${r.srcAddress}`,
    r.dstAddress && `dst-address=${r.dstAddress}`,
    r.routingMark && `routing-mark=${r.routingMark}`,
    r.interface && `interface=${r.interface}`,
    `action=${r.action}`,
    r.action.startsWith("lookup") && `table=${r.table}`,
  ];
  return parts.filter(Boolean).join(" ");
}

const clone = (p: Pkt): Pkt => ({ ...p, inner: p.inner && clone(p.inner) });
const stage = (name: string, result: string, kind: StageResult["kind"] = "skip"): StageResult => ({ name, result, kind, evals: [] });
const tupleOf = (p: Pkt): Tuple => ({ src: p.src, sport: p.sport ?? 0, dst: p.dst, dport: p.dport ?? 0 });
const sameTuple = (a: Tuple, b: Tuple) => a.src === b.src && a.dst === b.dst && a.sport === b.sport && a.dport === b.dport;

function service(p: Pkt): string {
  if (p.proto === "icmp") return "ICMP echo request → the router answers with an echo reply.";
  const tcp: Record<number, string> = { 21: "FTP", 22: "SSH", 23: "Telnet", 80: "WebFig (HTTP)", 443: "WebFig (HTTPS)", 8291: "Winbox", 8728: "API", 8729: "API-SSL" };
  const udp: Record<number, string> = { 53: "DNS", 67: "DHCP server", 123: "NTP", 161: "SNMP", 500: "IPsec IKE", 1701: "L2TP", 51820: "WireGuard" };
  const name = (p.proto === "tcp" ? tcp : p.proto === "udp" ? udp : {})[p.dport ?? -1];
  return name ? `Handled by the ${name} service.` : `No built-in service on ${p.proto}${p.dport ? "/" + p.dport : ""} (would answer with RST / port unreachable).`;
}

class Sim {
  steps: TraceStep[] = [];
  /** why candidate routes were rejected in the last lookup */
  routeWhy: string[] = [];
  hits: Record<string, number> = {};
  conntrack: ConnEntry[];
  nextConnId: number;
  verdict?: SimResult["verdict"];
  final?: SimResult["final"];

  constructor(private cfg: RouterConfig, prev: { conntrack: ConnEntry[]; nextConnId: number }) {
    this.conntrack = structuredClone(prev.conntrack);
    this.nextConnId = prev.nextConnId;
  }

  /* ---------- config helpers ---------- */

  iface(name?: string): Iface | undefined {
    return this.cfg.interfaces.find((i) => i.name === name && !i.disabled);
  }
  addrsOn(name: string) {
    return this.cfg.addresses.filter((a) => a.interface === name && !a.disabled && this.iface(name));
  }
  isLocal(ip: string) {
    return this.cfg.addresses.some((a) => !a.disabled && this.iface(a.interface) && a.address.split("/")[0] === ip);
  }
  prefSrc(iface: string, nextHop?: string): string | undefined {
    const addrs = this.addrsOn(iface);
    const hit = nextHop && addrs.find((a) => inRange(nextHop, ifaceNet(a.address)?.network ?? ""));
    return (hit || addrs[0])?.address.split("/")[0];
  }
  portsOf(bridge: string) {
    return this.cfg.interfaces.filter((i) => i.bridge === bridge && !i.disabled).map((i) => i.name);
  }
  inList(list: string, iface: string) {
    const l = this.cfg.interfaceLists.find((x) => x.name === list);
    if (list === "all") return true;
    return !!l && l.members.split(",").map((s) => s.trim()).includes(iface);
  }
  /** RouterOS address-type: local (one of the router's addresses), broadcast, or unicast */
  addrType(ip: string) {
    if (this.isLocal(ip) || ip.startsWith("127.")) return "local";
    if (ip === "255.255.255.255" || this.cfg.addresses.some((a) => { const r = parseRange(ifaceNet(a.address)?.network ?? ""); return !!r && r.len < 31 && intToIp(r.hi) === ip; })) return "broadcast";
    return "unicast";
  }
  /** the IPsec policy that would encrypt this packet, if any */
  outPolicy(p: Pkt) {
    if (p.tunnel === "esp") return undefined;
    return this.cfg.ipsecPolicies.find((x) => !x.disabled && x.action !== "none" && inRange(p.src, x.src) && inRange(p.dst, x.dst));
  }
  inAddrList(list: string, ip: string) {
    return this.cfg.addressLists.some((e) => e.list === list && inRange(ip, e.address));
  }

  /* ---------- trace helpers ---------- */

  snap(p: Pkt, c: Ctx): PktSnap {
    return {
      src: p.src || "(auto)",
      dst: p.dst,
      proto: p.proto,
      sport: p.sport,
      dport: p.dport,
      ttl: p.ttl,
      vlan: p.vlan,
      carries: p.inner ? `${p.tunnel?.toUpperCase()} carrying ${p.inner.src}→${p.inner.dst} ${p.inner.proto}` : undefined,
      tunnel: p.tunnel,
      inner: p.inner && { src: p.inner.src, dst: p.inner.dst, proto: p.inner.proto, sport: p.inner.sport, dport: p.inner.dport, ttl: p.inner.ttl, vlan: p.inner.vlan },
      packetMark: p.packetMark,
      connMark: p.connMark,
      routingMark: p.routingMark,
      inIface: c.inIface && (c.inPort ? `${c.inIface} (port ${c.inPort})` : c.inIface),
      outIface: c.outIface && (c.outPort ? `${c.outIface} → ${c.outPort}` : c.outIface),
      nextHop: c.nextHop,
      connState: c.connState,
    };
  }

  push(node: string, p: Pkt, c: Ctx, o: Partial<Omit<TraceStep, "node" | "pkt">> = {}) {
    if (this.steps.length > MAX_STEPS) throw new Error("Too many steps: the packet seems to loop.");
    this.steps.push({ node, notes: o.notes ?? [], outcome: o.outcome, stages: o.stages, status: o.status, pkt: this.snap(p, c) });
  }

  dropAt(node: string, p: Pkt, c: Ctx, why: string, notes: string[] = []): never {
    this.push(node, p, c, { notes: [...notes, why], status: "drop" });
    throw new Drop(why);
  }

  /** Run a node made of stages; a stage of kind "drop" stops the packet there. */
  node(node: string, p: Pkt, c: Ctx, stages: (() => StageResult)[], notes: string[] = []) {
    const res: StageResult[] = [];
    for (const f of stages) {
      const s = f();
      res.push(s);
      if (s.kind === "drop") {
        this.push(node, p, c, { stages: res, notes, status: "drop" });
        throw new Drop(`${s.name}: ${s.result}`);
      }
    }
    this.push(node, p, c, { stages: res, notes });
  }

  confirm(c: Ctx) {
    const conn = c.conn;
    if (!conn || c.confirmed) return;
    c.confirmed = true;
    if (c.pending) {
      this.conntrack.push(conn);
      c.pending = false;
    }
    if (c.dir === "reply") conn.seenReply = true;
    conn.packets++;
  }

  /* ---------- rules ---------- */

  match(rule: Rule, p: Pkt, c: Ctx, bridge: boolean): { ok: boolean; why?: string } {
    const natStates = [c.conn?.dnat && "dstnat", c.conn?.snat && "srcnat"].filter(Boolean).join(",");
    const checks: [RuleKey, string | undefined, (v: string, a: string) => boolean][] = [
      ["srcAddress", p.src, (v, a) => inRange(a, v)],
      ["dstAddress", p.dst, (v, a) => inRange(a, v)],
      ["protocol", p.proto, (v, a) => (PROTO_NUM[v] ?? v) === a],
      ["srcPort", p.sport?.toString(), (v, a) => portMatch(Number(a), v)],
      ["dstPort", p.dport?.toString(), (v, a) => portMatch(Number(a), v)],
      ["inInterface", bridge ? c.inPort : c.inIface, (v, a) => v === a],
      ["outInterface", bridge ? c.outPort : c.outIface, (v, a) => a.split(",").includes(v)],
      ["inInterfaceList", c.inIface, (v, a) => this.inList(v, a)],
      ["outInterfaceList", c.outIface, (v, a) => this.inList(v, a)],
      ["srcAddressList", p.src, (v, a) => this.inAddrList(v, a)],
      ["dstAddressList", p.dst, (v, a) => this.inAddrList(v, a)],
      ["connectionState", c.connState, (v, a) => v.split(",").map((s) => s.trim()).includes(a)],
      ["connectionNatState", natStates, (v, a) => v.split(",").some((s) => a.split(",").includes(s.trim()))],
      ["srcAddressType", this.addrType(p.src), (v, a) => v.split(",").map((s) => s.trim()).includes(a)],
      ["dstAddressType", this.addrType(p.dst), (v, a) => v.split(",").map((s) => s.trim()).includes(a)],
      ["packetMark", p.packetMark ?? "no-mark", (v, a) => v === a],
      ["connectionMark", p.connMark ?? "no-mark", (v, a) => v === a],
      ["routingMark", p.routingMark, (v, a) => v === a],
    ];
    if (rule.ipsecPolicy) {
      // ipsec-policy=in,ipsec | in,none | out,ipsec | out,none
      const [dir, kind] = rule.ipsecPolicy.split(",").map((s) => s.trim());
      const isIpsec = dir === "in" ? !!c.fromIpsec : !!this.outPolicy(p);
      const actual = isIpsec ? "ipsec" : "none";
      if (actual !== kind) return { ok: false, why: `ipsec-policy=${rule.ipsecPolicy} — packet is ${dir === "in" ? "incoming" : "outgoing"} ${actual === "ipsec" ? "IPsec" : "non-IPsec"} traffic` };
    }
    for (const [k, actual, test] of checks) {
      const spec = rule[k] as string | undefined;
      if (!spec) continue;
      const [negated, v] = neg(spec);
      const hit = actual !== undefined && actual !== "" && test(v, actual);
      if (hit === negated) {
        const shown = k === "connectionState" && actual === undefined ? "not tracked yet" : actual || "none";
        return { ok: false, why: `${rosName(k)}=${spec} — packet has ${shown}` };
      }
    }
    return { ok: true };
  }

  firstAddr(spec: string) {
    const r = parseRange(spec.split(",")[0]);
    return r ? intToIp(r.lo) : undefined;
  }

  /** Apply a matched rule's action. */
  apply(table: Table, rule: Rule, p: Pkt, c: Ctx): { stop: boolean; drop?: boolean; text: string; change?: boolean } {
    const conn = c.conn;
    const port = rule.toPorts ? parsePort(rule.toPorts.split("-")[0]) : undefined;
    const cont = rule.passthrough !== false;
    switch (rule.action) {
      case "accept":
        return { stop: true, text: "accept" };
      case "drop":
        return { stop: true, drop: true, text: "drop" };
      case "reject":
        return { stop: true, drop: true, text: "reject (ICMP unreachable sent back)" };
      case "fasttrack-connection":
        return { stop: false, text: "fasttrack-connection: later packets of this connection bypass the firewall" };
      case "log":
        return { stop: false, text: "log (written to the log, continues)" };
      case "passthrough":
        return { stop: false, text: "passthrough (counted, continues)" };
      case "notrack":
        c.untracked = true;
        return { stop: true, text: "notrack: connection tracking is skipped", change: true };
      case "mark-packet":
        p.packetMark = rule.newPacketMark;
        return { stop: !cont, text: `packet-mark → ${rule.newPacketMark}`, change: true };
      case "mark-connection":
        if (!conn) return { stop: !cont, text: "mark-connection ignored: packet is untracked" };
        conn.connMark = rule.newConnectionMark;
        p.connMark = rule.newConnectionMark;
        return { stop: !cont, text: `connection-mark → ${rule.newConnectionMark}`, change: true };
      case "mark-routing":
        p.routingMark = rule.newRoutingMark;
        return { stop: !cont, text: `routing-mark → ${rule.newRoutingMark} (use routing table "${rule.newRoutingMark}")`, change: true };
      case "change-ttl": {
        const [op, val] = (rule.newTtl ?? "").includes(":") ? rule.newTtl!.split(":") : ["set", rule.newTtl ?? ""];
        const v = Number(val);
        if (Number.isNaN(v)) return { stop: !cont, text: `change-ttl: bad new-ttl "${rule.newTtl}"` };
        const before = p.ttl;
        p.ttl = Math.max(0, Math.min(255, op === "increment" ? p.ttl + v : op === "decrement" ? p.ttl - v : v));
        return { stop: !cont, text: `TTL ${before} → ${p.ttl}`, change: true };
      }
      case "masquerade":
      case "src-nat": {
        const ip = rule.action === "masquerade" ? c.outIface && this.prefSrc(c.outIface, c.nextHop) : rule.toAddresses && this.firstAddr(rule.toAddresses);
        if (!ip) return { stop: true, text: `${rule.action}: no address to translate to` };
        const before = `${p.src}${p.sport ? ":" + p.sport : ""}`;
        p.src = ip;
        if (port !== undefined && p.sport !== undefined) p.sport = port;
        let remapped = "";
        if (conn && p.sport !== undefined) {
          // like the kernel: pick another source port if this ip:port is already used by another connection
          const taken = (sp: number) =>
            this.conntrack.some((e) => e !== conn && e.proto === conn.proto && e.reply.dst === ip && e.reply.dport === sp && e.reply.src === p.dst && e.reply.sport === (p.dport ?? 0));
          const orig = p.sport;
          while (taken(p.sport)) p.sport = p.sport >= 65535 ? 1024 : p.sport + 1;
          if (p.sport !== orig) remapped = ` (port ${orig} in use, remapped)`;
        }
        if (conn) {
          conn.snat = { ip, port: p.sport };
          conn.reply.dst = ip;
          conn.reply.dport = p.sport ?? 0;
        }
        return { stop: true, text: `${rule.action}: src ${before} → ${ip}${p.sport ? ":" + p.sport : ""}${remapped}`, change: true };
      }
      case "dst-nat":
      case "redirect": {
        const ip = rule.action === "redirect" ? (c.inIface && this.prefSrc(c.inIface)) || "127.0.0.1" : rule.toAddresses && this.firstAddr(rule.toAddresses);
        if (!ip) return { stop: true, text: "dst-nat: to-addresses is empty" };
        const before = `${p.dst}${p.dport ? ":" + p.dport : ""}`;
        p.dst = ip;
        if (port !== undefined && p.dport !== undefined) p.dport = port;
        if (conn) {
          conn.dnat = { ip, port: p.dport };
          conn.reply.src = ip;
          conn.reply.sport = p.dport ?? 0;
        }
        return { stop: true, text: `${rule.action}: dst ${before} → ${ip}${p.dport ? ":" + p.dport : ""}`, change: true };
      }
    }
    return { stop: false, text: rule.action };
  }

  chain(table: Table, chain: string, p: Pkt, c: Ctx, name: string): StageResult {
    const all = this.cfg.rules[table];
    const rules = all.filter((r) => r.chain === chain);
    if (!rules.length) return stage(name, "No rules in this chain", "skip");
    const bridge = table.startsWith("bridge");
    const evals: RuleEval[] = [];
    let kind: StageResult["kind"] = "ok";
    let result = "No rule matched → default action: accept";
    for (const rule of rules) {
      const index = all.indexOf(rule);
      if (rule.disabled) {
        evals.push({ ruleId: rule.id, index, matched: false, why: "disabled" });
        continue;
      }
      const m = this.match(rule, p, c, bridge);
      if (!m.ok) {
        evals.push({ ruleId: rule.id, index, matched: false, why: m.why });
        continue;
      }
      this.hits[rule.id] = (this.hits[rule.id] ?? 0) + 1;
      const a = this.apply(table, rule, p, c);
      evals.push({ ruleId: rule.id, index, matched: true, action: a.text });
      if (a.change) kind = "change";
      if (a.drop) return { name, table, chain, evals, result: `Rule #${index}: ${a.text}`, kind: "drop" };
      if (a.stop) {
        result = `Rule #${index}: ${a.text}`;
        break;
      }
      result = `Rule #${index}: ${a.text}; no final verdict → accept`;
    }
    return { name, table, chain, evals, result, kind };
  }

  track(p: Pkt, c: Ctx): StageResult {
    const name = "Connection tracking";
    if (c.untracked) {
      c.connState = "untracked";
      return stage(name, "untracked (raw notrack)", "info");
    }
    if (c.conn) return stage(name, `already tracked as connection #${c.conn.id} (${c.connState})`, "info");
    const t = tupleOf(p);
    for (const e of this.conntrack) {
      if (e.proto !== p.proto) continue;
      if (sameTuple(e.orig, t)) {
        Object.assign(c, { conn: e, dir: "orig", connState: e.seenReply ? "established" : "new", pending: false });
      } else if (sameTuple(e.reply, t)) {
        Object.assign(c, { conn: e, dir: "reply", connState: "established", pending: false });
      } else continue;
      if (e.connMark) p.connMark = e.connMark;
      return stage(name, `matches connection #${e.id} (${c.dir === "reply" ? "reply direction" : "original direction"}) → ${c.connState}`, "info");
    }
    const conn: ConnEntry = { id: this.nextConnId++, proto: p.proto, orig: t, reply: { src: t.dst, sport: t.dport, dst: t.src, dport: t.sport }, seenReply: false, packets: 0 };
    Object.assign(c, { conn, dir: "orig", connState: "new", pending: true });
    return stage(name, `new connection #${conn.id}`, "change");
  }

  nat(kind: "dstnat" | "srcnat", p: Pkt, c: Ctx): StageResult {
    const name = kind === "dstnat" ? "DST-NAT" : "SRC-NAT";
    const conn = c.conn;
    if (!conn) return stage(name, "untracked: NAT is not applied");
    c.natDone ??= {};
    if (c.pending) {
      if (c.natDone[kind]) return stage(name, "already evaluated for this packet");
      c.natDone[kind] = true;
      return this.chain("nat", kind, p, c, name);
    }
    // existing connection: NAT rules are not consulted; the stored translation is applied
    const fmt = (ip: string, port?: number) => `${ip}${port ? ":" + port : ""}`;
    if (kind === "dstnat") {
      if (c.dir === "orig" && conn.dnat) {
        p.dst = conn.dnat.ip;
        if (conn.dnat.port !== undefined && p.dport !== undefined) p.dport = conn.dnat.port;
        return stage(name, `connection #${conn.id}: dst → ${fmt(p.dst, p.dport)} (stored DST-NAT)`, "change");
      }
      if (c.dir === "reply" && conn.snat) {
        p.dst = conn.orig.src;
        if (p.dport !== undefined) p.dport = conn.orig.sport;
        return stage(name, `reply: SRC-NAT reversed, dst → ${fmt(p.dst, p.dport)}`, "change");
      }
    } else {
      if (c.dir === "orig" && conn.snat) {
        p.src = conn.snat.ip;
        if (conn.snat.port !== undefined && p.sport !== undefined) p.sport = conn.snat.port;
        return stage(name, `connection #${conn.id}: src → ${fmt(p.src, p.sport)} (stored SRC-NAT)`, "change");
      }
      if (c.dir === "reply" && conn.dnat) {
        p.src = conn.orig.dst;
        if (p.sport !== undefined) p.sport = conn.orig.dport;
        return stage(name, `reply: DST-NAT reversed, src → ${fmt(p.src, p.sport)}`, "change");
      }
    }
    return stage(name, `existing connection #${conn.id}: no translation, NAT rules not consulted`, "info");
  }

  queueTree(parent: string, p: Pkt, name: string): StageResult {
    const q = this.cfg.queueTrees.find((q) => !q.disabled && q.parent === parent && (!q.packetMark || q.packetMark === p.packetMark));
    return q ? stage(name, `queued in "${q.name}" (max-limit ${q.maxLimit || "none"})`, "info") : stage(name, "no queue matches");
  }

  simpleQueue(p: Pkt): StageResult {
    const q = this.cfg.simpleQueues.find((q) => !q.disabled && q.target.split(",").some((t) => inRange(p.src, t) || inRange(p.dst, t)));
    return q ? stage("Simple queues", `queued in "${q.name}" (max-limit ${q.maxLimit || "none"})`, "info") : stage("Simple queues", "no queue matches");
  }

  /* ---------- routing ---------- */

  noRouteNotes(dst: string): string[] {
    if (this.routeWhy.length) return this.routeWhy;
    return [
      `No route matches ${dst}, not even a default route (0.0.0.0/0).`,
      "On a real router the default route usually comes from the DHCP or PPPoE client (add-default-route=yes), so it isn't in /export. Add it under Router → Routes, e.g. dst 0.0.0.0/0 via your WAN gateway or the pppoe-out interface.",
    ];
  }

  /** Best active route to dst in one routing table; inactive candidates are explained in routeWhy. */
  pick(t: string, dst: string): RouteHit | null {
    const connected = this.cfg.addresses
      .filter((a) => !a.disabled && this.iface(a.interface))
      .map((a) => ({ dst: ifaceNet(a.address)?.network ?? "", gateway: a.interface, distance: 0, table: "main", connected: true }));
    const all = [...connected, ...this.cfg.routes.filter((r) => !r.disabled).map((r) => ({ ...r, connected: false }))];
    {
      const cands = all
        .filter((r) => r.table === t && inRange(dst, r.dst))
        .sort((a, b) => (parseRange(b.dst)?.len ?? 0) - (parseRange(a.dst)?.len ?? 0) || a.distance - b.distance);
      for (const r of cands) {
        const internet = r.dst === "0.0.0.0/0" || undefined;
        if (r.connected) return { iface: r.gateway, nextHop: dst, desc: `connected route ${r.dst} on ${r.gateway}` };
        if (isIp(r.gateway)) {
          const via = connected.find((cr) => inRange(r.gateway, cr.dst));
          if (via) return { iface: via.gateway, nextHop: r.gateway, internet, desc: `route ${r.dst} via ${r.gateway} (distance ${r.distance}, table ${t})` };
          this.routeWhy.push(`Route ${r.dst} via ${r.gateway} (table ${t}) is inactive: the gateway is not on any connected subnet. Does the router have an address in that network? WAN addresses often come from DHCP or PPPoE.`);
        } else if (this.iface(r.gateway)) {
          return { iface: r.gateway, nextHop: dst, internet, desc: `route ${r.dst} via interface ${r.gateway} (table ${t})` };
        } else {
          this.routeWhy.push(`Route ${r.dst} via ${r.gateway} (table ${t}) is inactive: interface "${r.gateway}" does not exist or is disabled.`);
        }
      }
      return null;
    }
  }

  /** Why a routing rule doesn't match this packet, or null when it matches. */
  ruleMiss(r: RoutingRule, p: Pkt, c: Ctx, mark?: string): string | null {
    if (r.srcAddress && !(p.src && inRange(p.src, r.srcAddress))) return `src ${p.src || "(not chosen yet)"} is not in ${r.srcAddress}`;
    if (r.dstAddress && !inRange(p.dst, r.dstAddress)) return `dst ${p.dst} is not in ${r.dstAddress}`;
    if (r.routingMark && r.routingMark !== mark) return `routing-mark is ${mark ? `"${mark}"` : "not set"}, rule wants "${r.routingMark}"`;
    if (r.interface && r.interface !== c.inIface) return c.inIface ? `arrived on ${c.inIface}, rule wants ${r.interface}` : `router-generated, rule wants in-interface ${r.interface}`;
    return null;
  }

  /**
   * Route a packet the way RouterOS v7 does: /routing rule entries in order, then the table picked by the
   * routing mark (falling back to main when it has no route), then main.
   */
  route(p: Pkt, c: Ctx, mark = p.routingMark): RouteResult {
    this.routeWhy = [];
    const notes: string[] = [];
    for (const [i, r] of (this.cfg.routingRules ?? []).entries()) {
      if (r.disabled) continue;
      const label = `Routing rule #${i} (${describeRoutingRule(r)})`;
      const miss = this.ruleMiss(r, p, c, mark);
      if (miss) {
        notes.push(`${label}: no match, ${miss}.`);
        continue;
      }
      if (r.action === "drop") return { drop: `${label} matched: the packet is dropped.`, notes };
      if (r.action === "unreachable") return { drop: `${label} matched: dropped, and ICMP network unreachable is sent back.`, notes };
      const hit = this.pick(r.table, p.dst);
      if (hit) return { hit, notes: [...notes, `${label} matched → lookup in table "${r.table}".`] };
      if (r.action === "lookup-only-in-table")
        return { drop: `${label} matched, but table "${r.table}" has no route to ${p.dst}, and lookup-only-in-table doesn't fall back.`, notes: [...notes, ...this.routeWhy] };
      notes.push(`${label} matched, but table "${r.table}" has no route to ${p.dst}; trying the next rule.`);
    }
    const table = mark || "main";
    const hit = this.pick(table, p.dst);
    if (hit) return { hit, notes };
    if (table !== "main") {
      const fb = this.pick("main", p.dst);
      if (fb) return { hit: fb, notes: [...notes, `Table "${table}" had no route; fell back to main.`] };
    }
    return { drop: `No route to ${p.dst}${mark ? ` in table "${mark}"` : ""}.`, notes: [...notes, ...this.noRouteNotes(p.dst)] };
  }

  /* ---------- flow ---------- */

  run(input: PacketInput): SimResult {
    try {
      const p = this.build(input);
      if (input.origin === "local") {
        this.push("proc", p, {}, { notes: ["A process on the router generates this packet."] });
        this.localOut(p, {});
      } else {
        this.receive(p, input.inInterface, false);
      }
      if (!this.verdict) this.verdict = { kind: "error", text: "Simulation ended without a verdict." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.verdict = e instanceof Drop ? { kind: "dropped", text: msg } : { kind: "error", text: msg };
    }
    return { steps: this.steps, verdict: this.verdict!, final: this.final, conntrack: this.conntrack, nextConnId: this.nextConnId, hits: this.hits };
  }

  build(i: PacketInput): Pkt {
    const bad = [i.dst, ...(i.origin === "local" && !i.src ? [] : [i.src])].find((x) => !isIp(x));
    if (bad !== undefined) throw new Error(`"${bad || "(empty)"}" is not a valid IPv4 address.`);
    const ports = i.proto === "tcp" || i.proto === "udp";
    const p: Pkt = { src: i.src, dst: i.dst, proto: i.proto, ttl: i.ttl, sport: ports ? parsePort(i.sport) ?? 1024 : undefined, dport: ports ? parsePort(i.dport) ?? 80 : undefined };
    if (i.encap === "none" || i.origin === "local") return p;
    if (i.encap === "vlan") return { ...p, vlan: i.vlanId };
    if (!isIp(i.outerSrc) || !isIp(i.outerDst)) throw new Error("Tunnel packets need valid outer source and destination addresses.");
    const proto = i.encap === "esp" ? "esp" : i.encap === "ipip" ? "ipip" : "gre";
    return { src: i.outerSrc, dst: i.outerDst, proto, ttl: 64, inner: p, tunnel: i.encap };
  }

  receive(p: Pkt, ifName: string, logical: boolean): void {
    const node = logical ? "in_log" : "in_phys";
    const ifc = this.iface(ifName);
    const c: Ctx = { inIface: ifName };
    if (!ifc) this.dropAt(node, p, c, `Interface "${ifName}" does not exist or is disabled.`);
    this.push(node, p, c, { notes: [`Arrives on ${ifName}${ifc.comment ? ` (${ifc.comment})` : ""}${p.vlan !== undefined ? `, tagged VLAN ${p.vlan}` : ""}.`] });
    if (ifc.bridge && this.iface(ifc.bridge)) {
      this.push("q_inbr", p, c, { outcome: "yes", notes: [`${ifName} is a port of ${ifc.bridge}.`] });
      return this.bridgeIn(p, { inIface: ifc.bridge, inPort: ifName }, ifc.bridge);
    }
    this.push("q_inbr", p, c, { outcome: "no", notes: [`${ifName} is not a bridge port.`] });
    this.l3In(p, c);
  }

  bridgeIn(p: Pkt, c: Ctx, br: string): void {
    this.node("br_dstnat", p, c, [() => this.chain("bridge-nat", "dstnat", p, c, "Bridge NAT dstnat")]);
    const ipfw = this.cfg.bridge.useIpFirewall && p.vlan === undefined;
    this.push("br_ipfw1", p, c, { outcome: ipfw ? "yes" : "no", notes: [`use-ip-firewall=${this.cfg.bridge.useIpFirewall ? "yes" : "no"}${this.cfg.bridge.useIpFirewall && !ipfw ? " (frame is not plain IP)" : ""}.`] });
    if (ipfw) this.prerouting("br_pre", p, c);

    // decide: is the frame for the router's MAC, or for another host on the bridge?
    const subnets = this.addrsOn(br).map((a) => ifaceNet(a.address)?.network ?? "");
    let toRouter: string | null = null;
    if (p.vlan !== undefined) {
      const v = this.cfg.interfaces.find((i) => i.type === "vlan" && i.parent === br && i.vlanId === p.vlan && !i.disabled);
      if (v) toRouter = `VLAN ${p.vlan} has interface ${v.name} on ${br} → frame goes to the router.`;
    } else if (this.isLocal(p.dst)) toRouter = `${p.dst} is the router's own address.`;
    else if (!subnets.some((s) => inRange(p.dst, s)))
      toRouter = `${p.dst} is outside ${br}'s subnet${subnets.length ? "s (" + subnets.join(", ") + ")" : ""}, so the host sent the frame to the router's MAC (its gateway).`;

    if (toRouter) {
      this.push("br_decision", p, c, { notes: [toRouter] });
      this.node("br_input", p, c, [() => this.chain("bridge-filter", "input", p, c, "Bridge filter input")]);
      return this.l3In(p, c);
    }

    const host = this.cfg.bridgeHosts.find((h) => h.bridge === br && h.ip === p.dst);
    if (host && host.port === c.inPort) this.dropAt("br_decision", p, c, `${p.dst} is on the same port (${host.port}); the bridge does not send it back.`);
    const ports = host ? [host.port] : this.portsOf(br).filter((x) => x !== c.inPort);
    if (!ports.length) this.dropAt("br_decision", p, c, "No other ports on the bridge to forward to.");
    c.outPort = ports.join(",");
    this.push("br_decision", p, c, {
      notes: [host ? `${p.dst} was learned on ${host.port} → forward there.` : `${p.dst} is not in the host table → flood to ${ports.join(", ")}.`],
    });
    this.node("br_forward", p, c, [() => this.chain("bridge-filter", "forward", p, c, "Bridge filter forward")]);
    this.push("br_ipfw2", p, c, { outcome: ipfw ? "yes" : "no" });
    if (ipfw) {
      c.outIface = br;
      this.forward(p, c, "br_fwd");
    }
    this.node("br_srcnat", p, c, [() => this.chain("bridge-nat", "srcnat", p, c, "Bridge NAT srcnat")]);
    this.push("br_ipfw3", p, c, { outcome: ipfw ? "yes" : "no" });
    if (ipfw) this.postrouting("br_post", p, c);
    this.push("q_encap", p, c, { outcome: "no", notes: ["Bridge ports are physical interfaces."] });
    this.physOut(p, c, c.outPort);
  }

  l3In(p: Pkt, c: Ctx): void {
    this.push("q_mpls_in", p, c, { outcome: "no", notes: ["No MPLS label (MPLS is not simulated)."] });
    if (p.vlan !== undefined) {
      this.push("q_ip_in", p, c, { outcome: "no", notes: [`VLAN-tagged frame (VID ${p.vlan}), not plain IP.`] });
      return this.decapCheck(p, c);
    }
    this.push("q_ip_in", p, c, { outcome: "yes", notes: [`IPv4 ${p.proto.toUpperCase()} packet.`] });
    this.prerouting("r_pre", p, c);
    this.routeIn(p, c);
  }

  prerouting(node: string, p: Pkt, c: Ctx) {
    this.node(node, p, c, [
      () => stage("Hotspot-in", "HotSpot not configured"),
      () => this.chain("raw", "prerouting", p, c, "Raw prerouting"),
      () => this.track(p, c),
      () => this.chain("mangle", "prerouting", p, c, "Mangle prerouting"),
      () => this.nat("dstnat", p, c),
    ]);
  }

  routeIn(p: Pkt, c: Ctx): void {
    if (this.isLocal(p.dst)) {
      this.push("rd_in", p, c, { notes: [`${p.dst} is one of the router's addresses → INPUT.`] });
      return this.input(p, c);
    }
    const res = this.route(p, c);
    if ("drop" in res) this.dropAt("rd_in", p, c, res.drop, res.notes);
    const rt = res.hit;
    Object.assign(c, { outIface: rt.iface, nextHop: rt.nextHop, internet: rt.internet });
    this.push("rd_in", p, c, { notes: [`Not for the router → FORWARD.`, ...res.notes, `Matched ${rt.desc}.`] });
    this.forward(p, c, "r_forward");
    this.postrouting("r_post", p, c);
    this.ipsecOut(p, c);
  }

  input(p: Pkt, c: Ctx): void {
    this.node("r_input", p, c, [
      () => this.chain("mangle", "input", p, c, "Mangle input"),
      () => this.chain("filter", "input", p, c, "Filter input"),
      () => this.queueTree("global", p, "HTB global (queue tree)"),
      () => this.simpleQueue(p),
    ]);
    if (p.tunnel === "esp" && p.inner) {
      const pol = this.cfg.ipsecPolicies.find((x) => !x.disabled && x.action === "encrypt" && x.saDst === p.src && x.saSrc === p.dst);
      if (pol) {
        this.push("ipsec_in", p, c, { outcome: "yes", notes: [`ESP from peer ${p.src} matches policy ${pol.src} ↔ ${pol.dst}.`] });
        this.confirm(c);
        const inner = clone(p.inner);
        const c2: Ctx = { inIface: c.inIface, inPort: c.inPort, fromIpsec: true };
        this.push("r_decrypt", inner, c2, { notes: ["ESP decrypted. The inner packet starts over at PREROUTING."] });
        this.prerouting("r_pre", inner, c2);
        return this.routeIn(inner, c2);
      }
      this.push("ipsec_in", p, c, { outcome: "no", notes: [`ESP from ${p.src}, but no IPsec policy has that peer.`] });
    } else {
      this.push("ipsec_in", p, c, { outcome: "no", notes: ["Not IPsec (ESP) traffic."] });
    }
    this.decapCheck(p, c);
  }

  decapCheck(p: Pkt, c: Ctx): void {
    if (p.vlan !== undefined) {
      const v = this.cfg.interfaces.find((i) => i.type === "vlan" && i.parent === c.inIface && i.vlanId === p.vlan && !i.disabled);
      if (!v) {
        this.push("q_decap", p, c, { outcome: "no", notes: [`No VLAN interface with vlan-id ${p.vlan} on ${c.inIface}.`] });
        this.dropAt("local_in", p, c, "Tagged frame with no matching VLAN interface is discarded.");
      }
      this.push("q_decap", p, c, { outcome: "yes", notes: [`VLAN ${p.vlan} on ${c.inIface} → ${v.name}.`] });
      const inner: Pkt = { ...p, vlan: undefined };
      this.push("decapsulation", inner, c, { notes: [`VLAN tag ${p.vlan} removed.`] });
      return this.receive(inner, v.name, true);
    }
    if (p.inner && p.tunnel && p.tunnel !== "esp") {
      const t = this.cfg.interfaces.find((i) => i.type === p.tunnel && !i.disabled && i.remote === p.src && (!i.local || i.local === p.dst));
      if (!t) {
        this.push("q_decap", p, c, { outcome: "no", notes: [`${p.tunnel.toUpperCase()} from ${p.src}, but no ${p.tunnel} interface has remote-address=${p.src}.`] });
        this.dropAt("local_in", p, c, "Unknown tunnel traffic is discarded by the router.");
      }
      this.confirm(c);
      this.push("q_decap", p, c, { outcome: "yes", notes: [`${p.tunnel.toUpperCase()} from ${p.src} belongs to tunnel ${t.name}.`] });
      const inner = clone(p.inner);
      this.push("decapsulation", inner, {}, { notes: [`Outer ${p.src}→${p.dst} header removed; inner packet enters on ${t.name}.`] });
      return this.receive(inner, t.name, true);
    }
    this.push("q_decap", p, c, { outcome: "no", notes: ["Nothing to decapsulate."] });
    this.confirm(c);
    this.push("local_in", p, c, { notes: ["Delivered to the router's own network stack."] });
    this.push("proc", p, c, { notes: [service(p)], status: "done" });
    this.verdict = { kind: "delivered", text: `Delivered to the router. ${service(p)}` };
    this.final = { pkt: clone(p), local: true, inIface: c.inIface };
  }

  forward(p: Pkt, c: Ctx, node: "r_forward" | "br_fwd") {
    const bridged = node === "br_fwd";
    this.node(node, p, c, [
      () => (bridged ? stage("Bridge decision", "bridged frame, use-ip-firewall=yes", "info") : stage("Bridge decision", "routed packet")),
      () => {
        if (bridged) return stage("TTL", "bridged: TTL unchanged");
        if (p.ttl <= 1) return stage("TTL", `TTL ${p.ttl} expired → ICMP time-exceeded sent back`, "drop");
        p.ttl--;
        return stage("TTL", `TTL ${p.ttl + 1} → ${p.ttl}`, "change");
      },
      () => this.chain("mangle", "forward", p, c, "Mangle forward"),
      () => this.chain("filter", "forward", p, c, "Filter forward"),
      () => stage("Accounting", "IP accounting not enabled"),
    ]);
  }

  postrouting(node: string, p: Pkt, c: Ctx) {
    this.node(node, p, c, [
      () => this.chain("mangle", "postrouting", p, c, "Mangle postrouting"),
      () => this.nat("srcnat", p, c),
      () => stage("Hotspot-out", "HotSpot not configured"),
      () => this.queueTree("global", p, "HTB global (queue tree)"),
      () => this.simpleQueue(p),
    ]);
  }

  ipsecOut(p: Pkt, c: Ctx): void {
    const pol = this.outPolicy(p);
    if (pol) {
      if (pol.action === "discard") this.dropAt("ipsec_out", p, c, `IPsec policy ${pol.src} → ${pol.dst} says discard.`);
      this.push("ipsec_out", p, c, { outcome: "yes", notes: [`Matches IPsec policy ${pol.src} → ${pol.dst} (peer ${pol.saDst}).`] });
      this.confirm(c);
      const outer: Pkt = { src: pol.saSrc, dst: pol.saDst, proto: "esp", tunnel: "esp", ttl: 64, inner: clone(p) };
      const c2: Ctx = {};
      this.push("r_encrypt", outer, c2, { notes: [`Encrypted into ESP ${pol.saSrc} → ${pol.saDst}. The new packet is routed again.`] });
      return this.routeOut(outer, c2);
    }
    this.push("ipsec_out", p, c, { outcome: "no", notes: [p.tunnel === "esp" ? "Already ESP." : "No IPsec policy matches."] });
    this.outIface(p, c);
  }

  outIface(p: Pkt, c: Ctx): void {
    this.push("q_mpls_out", p, c, { outcome: "no", notes: ["No MPLS label needed (MPLS is not simulated)."] });
    const ifc = this.iface(c.outIface);
    if (!ifc) this.dropAt("q_outbr", p, c, `Out-interface "${c.outIface}" is missing or disabled.`);
    if (ifc.type === "bridge") {
      this.push("q_outbr", p, c, { outcome: "yes", notes: [`${ifc.name} is a bridge.`] });
      const host = this.cfg.bridgeHosts.find((h) => h.bridge === ifc.name && h.ip === c.nextHop);
      const ports = host ? [host.port] : this.portsOf(ifc.name);
      if (!ports.length) this.dropAt("br_decision_out", p, c, `${ifc.name} has no ports.`);
      c.outPort = ports.join(",");
      this.push("br_decision_out", p, c, { notes: [host ? `Next hop ${c.nextHop} was learned on ${host.port}.` : `Next hop ${c.nextHop} is not in the host table → flood to ${ports.join(", ")}.`] });
      this.node("br_output", p, c, [() => this.chain("bridge-filter", "output", p, c, "Bridge filter output")]);
      this.node("br_srcnat", p, c, [() => this.chain("bridge-nat", "srcnat", p, c, "Bridge NAT srcnat")]);
      this.push("br_ipfw3", p, c, { outcome: "no", notes: ["Routed traffic: the IP firewall has already run."] });
    } else {
      this.push("q_outbr", p, c, { outcome: "no", notes: [`${ifc.name} is not a bridge.`] });
    }

    if (TUNNEL_TYPES.includes(ifc.type)) {
      this.push("q_encap", p, c, { outcome: "yes", notes: [`${ifc.name} is a ${ifc.type.toUpperCase()} interface.`] });
      this.node("htb2", p, c, [() => this.queueTree(ifc.name, p, "Interface HTB")]);
      this.push("log_out", p, c, { notes: [`Sent through ${ifc.name}.`] });
      this.confirm(c);
      if (ifc.type === "vlan") {
        const parent = this.iface(ifc.parent);
        if (!parent) this.dropAt("encapsulation", p, c, `VLAN parent "${ifc.parent}" is missing.`);
        const tagged: Pkt = { ...clone(p), vlan: ifc.vlanId };
        const c2: Ctx = { outIface: parent.name, nextHop: c.nextHop };
        this.push("encapsulation", tagged, c2, { notes: [`VLAN tag ${ifc.vlanId} added; the frame leaves through ${parent.name}.`] });
        this.push("local_out", tagged, c2);
        this.push("q_ip_out", tagged, c2, { outcome: "no", notes: ["A tagged frame is not plain IP: it skips the IP routing."] });
        return this.outIface(tagged, c2);
      }
      if (!ifc.remote || !isIp(ifc.remote)) this.dropAt("encapsulation", p, c, `${ifc.name} has no valid remote-address.`);
      const outer: Pkt = { src: ifc.local ?? "", dst: ifc.remote, proto: ifc.type === "ipip" ? "ipip" : "gre", tunnel: ifc.type as Pkt["tunnel"], ttl: 64, inner: clone(p) };
      this.push("encapsulation", outer, {}, { notes: [`Wrapped in ${ifc.type.toUpperCase()} ${outer.src || "(auto)"} → ${outer.dst}. The outer packet is router-generated.`] });
      return this.localOut(outer, {});
    }
    this.push("q_encap", p, c, { outcome: "no", notes: [`${ifc.name} is a physical interface.`] });
    this.physOut(p, c, c.outPort ?? ifc.name);
  }

  physOut(p: Pkt, c: Ctx, port: string) {
    this.node("htb1", p, c, [() => this.queueTree(port.split(",")[0], p, "Interface HTB")]);
    this.confirm(c);
    const where = port.includes(",") ? `flooded out ${port}` : `sent out ${port}`;
    const hop = !c.nextHop ? "" : c.internet ? (c.nextHop === p.dst ? " to the Internet" : ` to the Internet via gateway ${c.nextHop}`) : ` (next hop ${c.nextHop})`;
    this.push("out_phys", p, c, { notes: [`Frame ${where}${hop}.`], status: "done" });
    this.verdict = { kind: "forwarded", text: `Forwarded: ${where}${hop}.` };
    this.final = { pkt: clone(p), outIface: port.split(",")[0] };
  }

  localOut(p: Pkt, c: Ctx): void {
    this.push("local_out", p, c, { notes: ["Leaves the router's own stack as router-generated traffic."] });
    this.push("q_ip_out", p, c, { outcome: "yes" });
    this.routeOut(p, c);
  }

  routeOut(p: Pkt, c: Ctx): void {
    const res = this.route(p, c);
    if ("drop" in res) this.dropAt("rd_out", p, c, res.drop, res.notes);
    const rt = res.hit;
    Object.assign(c, { outIface: rt.iface, nextHop: rt.nextHop, lookupMark: p.routingMark, internet: rt.internet });
    const notes = [...res.notes, `Matched ${rt.desc}.`];
    if (!p.src) {
      p.src = this.prefSrc(rt.iface, rt.nextHop) ?? "0.0.0.0";
      notes.push(`Source address chosen: ${p.src} (address on ${rt.iface}).`);
    }
    this.push("rd_out", p, c, { notes });
    this.node("r_output", p, c, [
      () => stage("Bridge decision", "out-interface decided later"),
      () => this.chain("raw", "output", p, c, "Raw output"),
      () => this.track(p, c),
      () => this.chain("mangle", "output", p, c, "Mangle output"),
      () => this.chain("filter", "output", p, c, "Filter output"),
      () => {
        if (p.routingMark === c.lookupMark) return stage("Routing adjustment", "routing mark unchanged");
        const r2 = this.route(p, c);
        if ("drop" in r2) return stage("Routing adjustment", r2.drop, "drop");
        Object.assign(c, { outIface: r2.hit.iface, nextHop: r2.hit.nextHop, internet: r2.hit.internet });
        return stage("Routing adjustment", `re-routed by routing-mark: ${r2.hit.desc}`, "change");
      },
    ]);
    this.postrouting("r_post", p, c);
    this.ipsecOut(p, c);
  }
}

export function simulate(cfg: RouterConfig, input: PacketInput, prev: { conntrack: ConnEntry[]; nextConnId: number }): SimResult {
  return new Sim(cfg, prev).run(input);
}

/** Build the reply to a finished simulation (as it would arrive back at the router). */
export function replyInput(res: SimResult, base: PacketInput): PacketInput | null {
  const f = res.final;
  if (!f) return null;
  const p = f.pkt;
  const inner = p.inner;
  const swap = (x: Pkt) => ({ src: x.dst, dst: x.src, sport: x.dport?.toString() ?? "", dport: x.sport?.toString() ?? "", proto: x.proto });
  const payload = inner ? swap(inner) : swap(p);
  const encap: PacketInput["encap"] = p.vlan !== undefined ? "vlan" : p.tunnel ?? "none";
  return {
    ...base,
    ...payload,
    origin: f.local ? "local" : "iface",
    inInterface: f.local ? base.inInterface : f.outIface ?? base.inInterface,
    ttl: 64,
    encap: f.local ? "none" : encap,
    vlanId: p.vlan ?? base.vlanId,
    outerSrc: inner ? p.dst : "",
    outerDst: inner ? p.src : "",
  };
}
