"use client";

import { useSim } from "@/lib/store";
import { isIp, validPrefix } from "@/lib/sim/ip";
import type { Address, AddrListEntry, BridgeHost, Iface, IfaceList, IfaceType, IpsecPolicy, QueueTree, Route, RoutingRule, RoutingRuleAction, SimpleQueue } from "@/lib/sim/types";
import { RowsEditor, Toggle, type ColDef } from "../ui/form";

const IFACE_TYPES: IfaceType[] = ["ether", "bridge", "vlan", "gre", "ipip", "eoip"];
const ipOrPrefix = (v: string) => validPrefix(v);

export function useNames() {
  const cfg = useSim((s) => s.cfg);
  const ifaces = cfg.interfaces.map((i) => i.name);
  const bridges = cfg.interfaces.filter((i) => i.type === "bridge").map((i) => i.name);
  const lists = cfg.interfaceLists.map((l) => l.name);
  const addrLists = [...new Set(cfg.addressLists.map((a) => a.list))];
  const tables = [...new Set(["main", ...cfg.routes.map((r) => r.table), ...(cfg.routingRules ?? []).map((r) => r.table)])].filter(Boolean);
  return { ifaces, bridges, lists, addrLists, tables };
}

export function InterfacesEditor() {
  const rows = useSim((s) => s.cfg.interfaces);
  const setCfg = useSim((s) => s.setCfg);
  const { ifaces, bridges } = useNames();
  const tunnel = (r: Iface) => ["gre", "ipip", "eoip"].includes(r.type);
  const cols: ColDef<Iface>[] = [
    { key: "name", label: "Name" },
    { key: "type", label: "Type", options: IFACE_TYPES },
    { key: "bridge", label: "Bridge port of", options: ["", ...bridges], show: (r) => r.type !== "bridge" },
    { key: "parent", label: "VLAN on", options: ["", ...ifaces], show: (r) => r.type === "vlan" },
    { key: "vlanId", label: "VLAN ID", type: "number", show: (r) => r.type === "vlan" },
    { key: "local", label: "Local address", validate: isIp, show: tunnel },
    { key: "remote", label: "Remote address", validate: isIp, show: tunnel },
    { key: "comment", label: "Comment", wide: true },
  ];
  return (
    <RowsEditor
      rows={rows}
      cols={cols}
      onChange={(v) => setCfg((c) => void (c.interfaces = v))}
      newRow={(): Iface => ({ name: `ether${rows.length + 1}`, type: "ether" })}
      title={(r) => (
        <>
          <b>{r.name}</b> <span className="muted">{r.type}{r.bridge ? ` · port of ${r.bridge}` : ""}{r.type === "vlan" ? ` · ${r.vlanId} on ${r.parent}` : ""}</span>
        </>
      )}
      addLabel="Interface"
    />
  );
}

export function AddressesEditor() {
  const rows = useSim((s) => s.cfg.addresses);
  const setCfg = useSim((s) => s.setCfg);
  const { ifaces } = useNames();
  const cols: ColDef<Address>[] = [
    { key: "address", label: "Address", placeholder: "192.168.1.1/24", validate: ipOrPrefix, mono: true },
    { key: "interface", label: "Interface", options: ifaces },
  ];
  return (
    <RowsEditor
      rows={rows}
      cols={cols}
      onChange={(v) => setCfg((c) => void (c.addresses = v))}
      newRow={() => ({ address: "10.0.0.1/24", interface: ifaces[0] ?? "" })}
      title={(r) => <><b className="mono">{r.address}</b> <span className="muted">on {r.interface}</span></>}
      addLabel="Address"
    />
  );
}

export function RoutesEditor() {
  const rows = useSim((s) => s.cfg.routes);
  const setCfg = useSim((s) => s.setCfg);
  const { ifaces, tables } = useNames();
  const cols: ColDef<Route>[] = [
    { key: "dst", label: "Dst. address", validate: ipOrPrefix, mono: true },
    { key: "gateway", label: "Gateway", suggestions: ifaces, validate: (v) => isIp(v) || ifaces.includes(v), mono: true },
    { key: "distance", label: "Distance", type: "number" },
    { key: "table", label: "Routing table", suggestions: tables },
    { key: "comment", label: "Comment", wide: true },
  ];
  return (
    <>
      <p className="muted small">Connected routes are created automatically from IP addresses. A mangle <code>mark-routing</code> selects a table by name.</p>
      <RowsEditor
        rows={rows}
        cols={cols}
        onChange={(v) => setCfg((c) => void (c.routes = v))}
        newRow={() => ({ dst: "0.0.0.0/0", gateway: "", distance: 1, table: "main" })}
        title={(r) => <><b className="mono">{r.dst}</b> <span className="muted">via {r.gateway || "?"} · {r.table}</span></>}
        addLabel="Route"
      />
    </>
  );
}

const RR_ACTIONS: RoutingRuleAction[] = ["lookup", "lookup-only-in-table", "drop", "unreachable"];
// stable fallback: a fresh [] in the selector would re-render forever
const NO_RULES: RoutingRule[] = [];

export function RoutingRulesEditor() {
  const rows = useSim((s) => s.cfg.routingRules ?? NO_RULES);
  const setCfg = useSim((s) => s.setCfg);
  const { ifaces, tables } = useNames();
  const lookup = (r: RoutingRule) => r.action.startsWith("lookup");
  const cols: ColDef<RoutingRule>[] = [
    { key: "srcAddress", label: "Src. address", validate: ipOrPrefix, mono: true, placeholder: "any" },
    { key: "dstAddress", label: "Dst. address", validate: ipOrPrefix, mono: true, placeholder: "any" },
    { key: "routingMark", label: "Routing mark", suggestions: tables, placeholder: "any" },
    { key: "interface", label: "In-interface", options: ["", ...ifaces] },
    { key: "action", label: "Action", options: RR_ACTIONS },
    { key: "table", label: "Table", suggestions: tables, show: lookup },
    { key: "comment", label: "Comment", wide: true },
  ];
  return (
    <>
      <p className="muted small">
        <code>/routing rule</code>: checked top to bottom before the normal lookup. The first matching rule decides. <b>lookup</b> tries the next rule when its
        table has no route; <b>lookup-only-in-table</b> doesn&apos;t. Without a matching rule, the routing mark&apos;s table is used, then main.
      </p>
      <RowsEditor
        rows={rows}
        cols={cols}
        reorder
        onChange={(v) => setCfg((c) => void (c.routingRules = v))}
        newRow={(): RoutingRule => ({ srcAddress: "192.168.88.0/24", action: "lookup", table: tables.find((t) => t !== "main") ?? "main" })}
        title={(r, i) => (
          <>
            <b>#{i}</b> <span className="mono">{[r.srcAddress && `from ${r.srcAddress}`, r.dstAddress && `to ${r.dstAddress}`, r.routingMark && `mark ${r.routingMark}`, r.interface && `in ${r.interface}`].filter(Boolean).join(" · ") || "any"}</span>{" "}
            <span className="muted">→ {r.action}{lookup(r) ? ` ${r.table}` : ""}</span>
          </>
        )}
        addLabel="Routing rule"
        empty="No routing rules: every packet uses its routing mark's table, then main."
      />
    </>
  );
}

export function ListsEditor() {
  const rows = useSim((s) => s.cfg.interfaceLists);
  const setCfg = useSim((s) => s.setCfg);
  const cols: ColDef<IfaceList>[] = [
    { key: "name", label: "List name" },
    { key: "members", label: "Members (comma separated)", wide: true, mono: true },
  ];
  return (
    <RowsEditor
      rows={rows}
      cols={cols}
      onChange={(v) => setCfg((c) => void (c.interfaceLists = v))}
      newRow={() => ({ name: "NEW", members: "" })}
      title={(r) => <b>{r.name}</b>}
      addLabel="Interface list"
    />
  );
}

export function AddressListEditor() {
  const rows = useSim((s) => s.cfg.addressLists);
  const setCfg = useSim((s) => s.setCfg);
  const { addrLists } = useNames();
  const cols: ColDef<AddrListEntry>[] = [
    { key: "list", label: "List", suggestions: addrLists },
    { key: "address", label: "Address", validate: ipOrPrefix, mono: true },
  ];
  return (
    <RowsEditor
      rows={rows}
      cols={cols}
      onChange={(v) => setCfg((c) => void (c.addressLists = v))}
      newRow={() => ({ list: addrLists[0] ?? "list1", address: "" })}
      title={(r) => <><b>{r.list}</b> <span className="muted mono">{r.address}</span></>}
      addLabel="Entry"
    />
  );
}

export function BridgeSettings() {
  const v = useSim((s) => s.cfg.bridge.useIpFirewall);
  const setCfg = useSim((s) => s.setCfg);
  return (
    <Toggle
      label="use-ip-firewall"
      checked={v}
      onChange={(x) => setCfg((c) => void (c.bridge.useIpFirewall = x))}
      hint="Pass bridged IP traffic through the IP firewall chains"
    />
  );
}

export function BridgeHostsEditor() {
  const rows = useSim((s) => s.cfg.bridgeHosts);
  const setCfg = useSim((s) => s.setCfg);
  const { ifaces, bridges } = useNames();
  const cols: ColDef<BridgeHost>[] = [
    { key: "ip", label: "Host IP", validate: isIp, mono: true },
    { key: "bridge", label: "Bridge", options: bridges },
    { key: "port", label: "Learned on port", options: ifaces },
  ];
  return (
    <>
      <p className="muted small">The bridge host table, keyed by IP for simplicity. Hosts that aren&apos;t listed are flooded to every port.</p>
      <RowsEditor
        rows={rows}
        cols={cols}
        onChange={(v) => setCfg((c) => void (c.bridgeHosts = v))}
        newRow={() => ({ ip: "", bridge: bridges[0] ?? "", port: "" })}
        title={(r) => <><b className="mono">{r.ip || "?"}</b> <span className="muted">→ {r.port || "?"}</span></>}
        addLabel="Host"
      />
    </>
  );
}

export function IpsecEditor() {
  const rows = useSim((s) => s.cfg.ipsecPolicies);
  const setCfg = useSim((s) => s.setCfg);
  const cols: ColDef<IpsecPolicy>[] = [
    { key: "src", label: "Src. address", validate: ipOrPrefix, mono: true },
    { key: "dst", label: "Dst. address", validate: ipOrPrefix, mono: true },
    { key: "action", label: "Action", options: ["encrypt", "discard", "none"] },
    { key: "saSrc", label: "SA src (local)", validate: isIp, mono: true },
    { key: "saDst", label: "SA dst (peer)", validate: isIp, mono: true },
  ];
  return (
    <>
      <p className="muted small">Tunnel-mode policies. Matching traffic is encrypted into ESP between the SA addresses. Incoming ESP from the peer is decrypted.</p>
      <RowsEditor
        rows={rows}
        cols={cols}
        onChange={(v) => setCfg((c) => void (c.ipsecPolicies = v))}
        newRow={(): IpsecPolicy => ({ src: "192.168.88.0/24", dst: "10.30.0.0/16", action: "encrypt", saSrc: "203.0.113.10", saDst: "198.51.100.9" })}
        title={(r) => <><b className="mono">{r.src}</b> → <b className="mono">{r.dst}</b> <span className="muted">{r.action}</span></>}
        addLabel="Policy"
        empty="No IPsec policies."
      />
    </>
  );
}

export function QueuesEditor({ ifaceOnly }: { ifaceOnly?: boolean }) {
  const simple = useSim((s) => s.cfg.simpleQueues);
  const tree = useSim((s) => s.cfg.queueTrees);
  const setCfg = useSim((s) => s.setCfg);
  const { ifaces } = useNames();
  const sCols: ColDef<SimpleQueue>[] = [
    { key: "name", label: "Name" },
    { key: "target", label: "Target", mono: true },
    { key: "maxLimit", label: "Max limit (up/down)", placeholder: "10M/50M" },
  ];
  const tCols: ColDef<QueueTree>[] = [
    { key: "name", label: "Name" },
    { key: "parent", label: "Parent", options: ["global", ...ifaces] },
    { key: "packetMark", label: "Packet mark" },
    { key: "maxLimit", label: "Max limit", placeholder: "10M" },
  ];
  return (
    <>
      <h4 className="subhead">Queue tree</h4>
      <RowsEditor
        rows={tree}
        cols={tCols}
        onChange={(v) => setCfg((c) => void (c.queueTrees = v))}
        newRow={() => ({ name: `queue${tree.length + 1}`, parent: ifaceOnly ? ifaces[0] ?? "global" : "global", packetMark: "", maxLimit: "" })}
        title={(r) => <><b>{r.name}</b> <span className="muted">parent {r.parent}{r.packetMark ? ` · mark ${r.packetMark}` : ""}</span></>}
        addLabel="Queue"
        empty="No queue tree entries."
      />
      {!ifaceOnly && (
        <>
          <h4 className="subhead">Simple queues</h4>
          <RowsEditor
            rows={simple}
            cols={sCols}
            onChange={(v) => setCfg((c) => void (c.simpleQueues = v))}
            newRow={() => ({ name: `queue${simple.length + 1}`, target: "", maxLimit: "" })}
            title={(r) => <><b>{r.name}</b> <span className="muted mono">{r.target}</span></>}
            addLabel="Simple queue"
          />
        </>
      )}
    </>
  );
}
