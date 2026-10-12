"use client";

import { useState } from "react";
import { useSim } from "@/lib/store";
import { isIp, validPrefix } from "@/lib/sim/ip";
import { portForwardRules, TEMPLATES, type PortForward } from "@/lib/sim/templates";
import { Field, Toggle } from "../ui/form";

/** Grid of ready-made router setups. */
export function TemplatePicker() {
  const current = useSim((s) => s.templateId);
  const loadTemplate = useSim((s) => s.loadTemplate);
  const [pending, setPending] = useState<string | null>(null);
  return (
    <div className="templates">
      {current === "imported" && (
        <div className="tpl on">
          <div className="tpl-top"><b>Imported configuration</b><span className="pill">loaded</span></div>
          <p className="muted small">Loaded from your router. Picking a setup below replaces it.</p>
        </div>
      )}
      {TEMPLATES.map((t) => (
        <div key={t.id} className={t.id === current ? "tpl on" : "tpl"}>
          <div className="tpl-top">
            <b>{t.name}</b>
            {t.id === current && <span className="pill">loaded</span>}
          </div>
          <p className="muted small">{t.desc}</p>
          {pending === t.id ? (
            <div className="tpl-confirm">
              <span className="small">Replace the current config?</span>
              <button className="btn sm primary" onClick={() => { loadTemplate(t.id); setPending(null); }}>Load</button>
              <button className="btn sm" onClick={() => setPending(null)}>Cancel</button>
            </div>
          ) : (
            <button className="btn sm" onClick={() => setPending(t.id)}>{t.id === current ? "Reload" : "Use this setup"}</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Test packets for the loaded setup. */
export function TemplatePackets() {
  const id = useSim((s) => s.templateId);
  const run = useSim((s) => s.run);
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t?.packets.length) return null;
  return (
    <div className="tplpackets">
      <h4 className="subhead">Try with “{t.name}”</h4>
      {t.packets.map((p) => (
        <button key={p.name} className="tplpacket" onClick={() => run({ ...p.p })}>
          <b>{p.name}</b>
          <span className="muted small">{p.desc}</span>
        </button>
      ))}
    </div>
  );
}

/** DST-NAT port-forward wizard: generates the NAT rule(s) like a RouterOS admin would. */
export function PortForwardWizard({ onDone }: { onDone?: () => void }) {
  const setCfg = useSim((s) => s.setCfg);
  const wanIp = useSim((s) => s.cfg.addresses.find((a) => a.interface === "ether1")?.address.split("/")[0] ?? "");
  const [f, setF] = useState<PortForward>({ protocol: "tcp", extPort: "8443", intAddress: "192.168.88.20", intPort: "443", wanIp, hairpin: false, lanSubnet: "192.168.88.0/24", comment: "" });
  const [msg, setMsg] = useState("");
  const set = <K extends keyof PortForward>(k: K, v: PortForward[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = isIp(f.intAddress) && /^\d+([-,]\d+)*$/.test(f.extPort) && (!f.intPort || /^\d+$/.test(f.intPort)) && (!f.hairpin || (isIp(f.wanIp) && validPrefix(f.lanSubnet)));

  const add = () => {
    const { nat } = portForwardRules(f);
    setCfg((c) => {
      for (const rule of nat) {
        if (rule.chain === "srcnat") c.rules.nat.unshift(rule);
        else c.rules.nat.push(rule);
      }
    });
    setMsg(`Added ${nat.length} NAT rule${nat.length > 1 ? "s" : ""}.`);
    onDone?.();
  };

  return (
    <div className="wizard">
      <div className="grid2">
        <Field label="Protocol" value={f.protocol} options={["tcp", "udp"]} onChange={(v) => set("protocol", v as "tcp" | "udp")} />
        <Field label="External port(s)" value={f.extPort} mono onChange={(v) => set("extPort", v)} invalid={!/^\d+([-,]\d+)*$/.test(f.extPort)} />
        <Field label="Internal address" value={f.intAddress} mono onChange={(v) => set("intAddress", v)} invalid={!isIp(f.intAddress)} />
        <Field label="Internal port" value={f.intPort} mono placeholder="same" onChange={(v) => set("intPort", v)} />
        <Field label="Comment" value={f.comment} wide onChange={(v) => set("comment", v)} />
        <Toggle label="Hairpin NAT (LAN clients use the public IP)" checked={f.hairpin} onChange={(v) => set("hairpin", v)} />
        {f.hairpin && <Field label="Public IP" value={f.wanIp} mono onChange={(v) => set("wanIp", v)} invalid={!isIp(f.wanIp)} />}
        {f.hairpin && <Field label="LAN subnet" value={f.lanSubnet} mono onChange={(v) => set("lanSubnet", v)} invalid={!validPrefix(f.lanSubnet)} />}
      </div>
      <code className="preview-cmd">
        {portForwardRules(f).nat.map((r) => `/ip firewall nat add chain=${r.chain} action=${r.action}${r.protocol ? ` protocol=${r.protocol}` : ""}${r.srcAddress ? ` src-address=${r.srcAddress}` : ""}${r.dstAddress ? ` dst-address=${r.dstAddress}` : ""}${r.inInterfaceList ? ` in-interface-list=${r.inInterfaceList}` : ""}${r.dstPort ? ` dst-port=${r.dstPort}` : ""}${r.toAddresses ? ` to-addresses=${r.toAddresses}` : ""}${r.toPorts ? ` to-ports=${r.toPorts}` : ""}`).join("\n")}
      </code>
      <div className="cmdbar">
        {msg && <span className="ok small">{msg}</span>}
        <span className="sp" />
        <button className="btn sm primary" disabled={!valid} onClick={add}>Add port forward</button>
      </div>
    </div>
  );
}
