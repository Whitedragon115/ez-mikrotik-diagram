"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSim } from "@/lib/store";
import { CHAINS, LAYERS, byId, nodeColor, plain, type ChainKey } from "@/lib/flow";
import { NODE_EDITOR, type RuleTab } from "@/lib/sim/nodes";
import RulesEditor from "./RulesEditor";
import {
  AddressesEditor, BridgeHostsEditor, BridgeSettings, InterfacesEditor, IpsecEditor, QueuesEditor, RoutesEditor, RoutingRulesEditor,
} from "./editors";

function RuleTabs({ tabs, queues, chain }: { tabs: RuleTab[]; queues?: boolean; chain?: ChainKey }) {
  const [tab, setTab] = useState(0);
  const counts = useSim(useShallow((s) => tabs.map((t) => s.cfg.rules[t.table].filter((r) => r.chain === t.chain && !r.disabled).length)));
  const all = [...tabs.map((t, i) => ({ label: t.label, n: counts[i] })), ...(queues ? [{ label: "Queues", n: undefined }] : [])];
  const i = Math.min(tab, all.length - 1);
  return (
    <>
      {chain && (
        <div className="stagestrip">
          {CHAINS[chain].map((s, k) => (
            <span key={k} className={s[1] === "cond" ? "stg cond" : "stg"} style={{ ["--tc" as string]: `var(--t-${s[1] === "ttl" ? "acct" : s[1]})` }} title={s[3]}>
              {s[0]}
            </span>
          ))}
        </div>
      )}
      {all.length > 1 && (
        <div className="tabs">
          {all.map((t, k) => (
            <button key={t.label} className={k === i ? "tab on" : "tab"} onClick={() => setTab(k)}>
              {t.label}
              {t.n !== undefined && <span className="pill">{t.n}</span>}
            </button>
          ))}
        </div>
      )}
      {i < tabs.length ? <RulesEditor key={`${tabs[i].table}-${tabs[i].chain}`} table={tabs[i].table} chain={tabs[i].chain} /> : <QueuesEditor />}
    </>
  );
}

const CHAIN_OF: Record<string, ChainKey> = {
  br_pre: "prerouting", r_pre: "prerouting", r_input: "input", r_forward: "forward", br_fwd: "forward", r_output: "output", r_post: "postrouting", br_post: "postrouting",
};

export default function Inspector() {
  const id = useSim((s) => s.selected);
  const select = useSim((s) => s.select);
  const setLeft = useSim((s) => s.setLeft);
  if (!id) return null;
  const n = byId[id];
  const ed = NODE_EDITOR[id] ?? { kind: "info" };
  const color = n.L === "if" ? nodeColor(n) : LAYERS[n.L].c;

  return (
    <aside className="panel inspector no-canvas">
      <div className="panel-head">
        <div>
          <div className="eyebrow" style={{ color: `var(${color})` }}>{LAYERS[n.L].name}</div>
          <h2>{plain(n.t)}{n.sub && <span className="muted"> · {n.sub}</span>}</h2>
        </div>
        <button className="icon" onClick={() => select(null)} title="Close">✕</button>
      </div>
      <div className="panel-body">
        <p className="desc">{n.d}</p>
        {ed.kind === "rules" && <RuleTabs tabs={ed.tabs} queues={ed.queues} chain={CHAIN_OF[id]} />}
        {ed.kind === "routes" && (
          <>
            <RoutesEditor />
            <h4 className="subhead">Routing rules</h4>
            <RoutingRulesEditor />
          </>
        )}
        {ed.kind === "ipsec" && <IpsecEditor />}
        {ed.kind === "bridgeHosts" && <BridgeHostsEditor />}
        {ed.kind === "bridgePorts" && (
          <>
            <p className="muted small">Set an interface&apos;s <b>Bridge port of</b> field to add it to a bridge.</p>
            <InterfacesEditor />
          </>
        )}
        {ed.kind === "ipfw" && (
          <>
            <BridgeSettings />
            <p className="muted small">When this is on, bridged IP traffic also passes the IP Prerouting, Forward and Postrouting chains, with their raw, mangle, NAT and filter rules.</p>
          </>
        )}
        {ed.kind === "tunnels" && (
          <>
            <p className="muted small">VLAN interfaces and GRE / IPIP / EoIP tunnels. Traffic routed to them is encapsulated. Matching incoming traffic is decapsulated onto them.</p>
            <InterfacesEditor />
          </>
        )}
        {ed.kind === "ifaceQueues" && <QueuesEditor ifaceOnly />}
        {ed.kind === "addresses" && (
          <>
            <h4 className="subhead">Router addresses</h4>
            <AddressesEditor />
          </>
        )}
        {ed.kind === "packet" && (
          <button className="btn primary" onClick={() => setLeft("packet")}>Edit the test packet</button>
        )}
        {ed.kind === "mpls" && <p className="note">MPLS is shown for completeness but isn&apos;t simulated. Packets always take the “no MPLS” branch.</p>}
      </div>
    </aside>
  );
}
