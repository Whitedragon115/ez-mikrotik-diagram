"use client";

import { useState } from "react";
import { useSim } from "@/lib/store";
import { PRESETS } from "@/lib/sim/defaults";
import { isIp } from "@/lib/sim/ip";
import type { Encap, PacketInput, Proto } from "@/lib/sim/types";
import { Field, Section } from "../ui/form";
import { Select } from "../ui/Select";
import { PortForwardWizard, TemplatePackets, TemplatePicker } from "./Setups";
import {
  AddressListEditor, AddressesEditor, BridgeHostsEditor, BridgeSettings, InterfacesEditor, IpsecEditor, ListsEditor, QueuesEditor, RoutesEditor,
} from "./editors";

const PROTOS: Proto[] = ["tcp", "udp", "icmp", "gre", "esp"];
const ENCAPS: Encap[] = ["none", "vlan", "gre", "ipip", "eoip", "esp"];

function PacketTab() {
  const p = useSim((s) => s.packet);
  const [preset, setPreset] = useState("");
  const setPacket = useSim((s) => s.setPacket);
  const run = useSim((s) => s.run);
  const reply = useSim((s) => s.reply);
  const result = useSim((s) => s.result);
  const ifaces = useSim((s) => s.cfg.interfaces.filter((i) => !i.disabled).map((i) => i.name).join(","));
  const set = <K extends keyof PacketInput>(k: K, v: PacketInput[K]) => setPacket({ [k]: v } as Partial<PacketInput>);
  const ports = p.proto === "tcp" || p.proto === "udp";
  const tunnel = p.origin === "iface" && !["none", "vlan"].includes(p.encap);
  const canReply = !!result?.final && result.verdict.kind !== "dropped";

  return (
    <div className="panel-body">
      <TemplatePackets />
      <h4 className="subhead">General presets</h4>
      <div className="presets">
        <Select
          value={preset}
          placeholder="Choose a preset to send…"
          options={PRESETS.map((pr) => ({ value: pr.name, hint: pr.desc }))}
          onChange={(name) => {
            const pr = PRESETS.find((x) => x.name === name);
            if (!pr) return;
            setPreset(name);
            run({ ...pr.p });
          }}
        />
      </div>

      <div className="seg">
        <button className={p.origin === "iface" ? "on" : ""} onClick={() => set("origin", "iface")}>Arrives on interface</button>
        <button className={p.origin === "local" ? "on" : ""} onClick={() => set("origin", "local")}>From the router</button>
      </div>

      <div className="grid2">
        {p.origin === "iface" && <Field label="In-interface" value={p.inInterface} options={ifaces.split(",")} onChange={(v) => set("inInterface", v)} wide />}
        <Field label="Src. address" value={p.src} mono placeholder={p.origin === "local" ? "auto (pref-src)" : "192.168.88.10"} invalid={!!p.src && !isIp(p.src)} onChange={(v) => set("src", v.trim())} />
        <Field label="Dst. address" value={p.dst} mono invalid={!isIp(p.dst)} onChange={(v) => set("dst", v.trim())} />
        <Field label="Protocol" value={p.proto} options={PROTOS} onChange={(v) => set("proto", v as Proto)} />
        <Field label="TTL" value={p.ttl} type="number" onChange={(v) => set("ttl", Math.max(0, Math.min(255, Number(v) || 0)))} />
        {ports && <Field label="Src. port" value={p.sport} mono onChange={(v) => set("sport", v)} />}
        {ports && <Field label="Dst. port" value={p.dport} mono onChange={(v) => set("dport", v)} />}
      </div>

      {p.origin === "iface" && (
        <>
          <h4 className="subhead">Encapsulation (as received)</h4>
          <div className="grid2">
            <Field label="Wrapped in" value={p.encap} options={ENCAPS} onChange={(v) => set("encap", v as Encap)} />
            {p.encap === "vlan" && <Field label="VLAN ID" value={p.vlanId} type="number" onChange={(v) => set("vlanId", Number(v) || 1)} />}
            {tunnel && <Field label="Outer src" value={p.outerSrc} mono invalid={!isIp(p.outerSrc)} onChange={(v) => set("outerSrc", v.trim())} />}
            {tunnel && <Field label="Outer dst" value={p.outerDst} mono invalid={!isIp(p.outerDst)} onChange={(v) => set("outerDst", v.trim())} />}
          </div>
          {tunnel && <p className="muted small">The fields above describe the inner packet. The outer {p.encap.toUpperCase()} header uses the outer addresses.</p>}
        </>
      )}

      <div className="runbar">
        <button className="btn primary big" onClick={() => run()}>▶ Send packet</button>
        <button className="btn big" onClick={reply} disabled={!canReply} title="Send the reply back through the router; connection tracking reverses NAT">
          ↩ Send reply
        </button>
      </div>
      <p className="muted small">Connection tracking persists between runs. Send a packet, then send its reply to see established state and NAT reversal.</p>
    </div>
  );
}

function RouterTab() {
  const cfg = useSim((s) => s.cfg);
  const setCfg = useSim((s) => s.setCfg);
  const resetConfig = useSim((s) => s.resetConfig);
  const setImportOpen = useSim((s) => s.setImportOpen);

  return (
    <div className="panel-body">
      <div className="grid2">
        <Field label="Identity" value={cfg.identity} wide onChange={(v) => setCfg((c) => void (c.identity = v))} />
      </div>
      <button className="import-cta" onClick={() => setImportOpen(true)}>
        <b>⇩ Import from my MikroTik</b>
        <span>Paste /export, upload a .rsc file, or connect with a read-only account</span>
      </button>
      <Section title="Ready-made setups" defaultOpen><TemplatePicker /></Section>
      <Section title="Quick: port forward (DST-NAT)"><PortForwardWizard /></Section>
      <Section title="Interfaces" count={cfg.interfaces.length}><InterfacesEditor /></Section>
      <Section title="IP addresses" count={cfg.addresses.length}><AddressesEditor /></Section>
      <Section title="Routes" count={cfg.routes.length}><RoutesEditor /></Section>
      <Section title="Interface lists" count={cfg.interfaceLists.length}><ListsEditor /></Section>
      <Section title="Address lists" count={cfg.addressLists.length}><AddressListEditor /></Section>
      <Section title="Bridge" count={cfg.bridgeHosts.length}>
        <BridgeSettings />
        <BridgeHostsEditor />
      </Section>
      <Section title="IPsec policies" count={cfg.ipsecPolicies.length}><IpsecEditor /></Section>
      <Section title="Queues" count={cfg.simpleQueues.length + cfg.queueTrees.length}><QueuesEditor /></Section>
      <p className="muted small">Firewall rules live on the hooks themselves: click a block on the canvas (e.g. <b>FORWARD</b>) to edit its chain.</p>

      <div className="cfgbar">
        <button className="btn sm primary" onClick={() => window.open("/preview", "_blank", "noopener")}>Preview config ↗</button>
        <button className="btn sm" onClick={() => useSim.setState({ exportOpen: true })}>Export…</button>
        <button className="btn sm danger" onClick={resetConfig} title="Reset to the default home setup">Reset</button>
      </div>
    </div>
  );
}

export default function LeftPanel() {
  const tab = useSim((s) => s.left);
  const setLeft = useSim((s) => s.setLeft);
  if (!tab) return null;
  return (
    <aside className="panel left no-canvas">
      <div className="panel-head tabs-head">
        <div className="tabs big">
          <button className={tab === "packet" ? "tab on" : "tab"} onClick={() => setLeft("packet")}>Packet</button>
          <button className={tab === "router" ? "tab on" : "tab"} onClick={() => setLeft("router")}>Router setup</button>
        </div>
        <button className="icon" onClick={() => setLeft(null)} title="Close">✕</button>
      </div>
      {tab === "packet" ? <PacketTab /> : <RouterTab />}
    </aside>
  );
}
