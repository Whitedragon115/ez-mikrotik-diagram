"use client";

import { useMemo, useState } from "react";
import { useSim } from "@/lib/store";
import { formatRule, matchersFor, newId, paramsFor, parseRuleCommand, rosName, TABLE_INFO, type RuleKey } from "@/lib/sim/rules";
import { validPrefix } from "@/lib/sim/ip";
import type { Rule, Table } from "@/lib/sim/types";
import { Field, Toggle } from "../ui/form";
import { useNames } from "./editors";
import { PortForwardWizard } from "./Setups";

const PROTOS = ["tcp", "udp", "icmp", "gre", "esp", "ipip"];
const STATES = ["new", "established", "related", "invalid", "untracked", "established,related", "established,related,untracked", "!established"];
const NAT_STATES = ["dstnat", "srcnat", "!dstnat", "!srcnat"];

function RuleForm({ table, rule, onChange }: { table: Table; rule: Rule; onChange: (r: Rule) => void }) {
  const cfg = useSim((s) => s.cfg);
  const { ifaces, lists, addrLists, tables } = useNames();
  const marks = useMemo(() => {
    const m = cfg.rules.mangle;
    return {
      packet: [...new Set(m.map((r) => r.newPacketMark).filter(Boolean) as string[])],
      conn: [...new Set(m.map((r) => r.newConnectionMark).filter(Boolean) as string[])],
    };
  }, [cfg.rules.mangle]);
  const withNeg = (xs: string[]) => [...xs, ...xs.map((x) => "!" + x)];
  const sugg: Partial<Record<RuleKey, string[]>> = {
    protocol: PROTOS,
    inInterface: withNeg(ifaces),
    outInterface: withNeg(ifaces),
    inInterfaceList: withNeg(lists),
    outInterfaceList: withNeg(lists),
    srcAddressList: withNeg(addrLists),
    dstAddressList: withNeg(addrLists),
    connectionState: STATES,
    connectionNatState: NAT_STATES,
    packetMark: [...marks.packet, "no-mark"],
    connectionMark: [...marks.conn, "no-mark"],
    routingMark: tables,
    newPacketMark: marks.packet,
    newConnectionMark: marks.conn,
    newRoutingMark: tables,
    newTtl: ["set:64", "decrement:1", "increment:1"],
  };
  const validate: Partial<Record<RuleKey, (v: string) => boolean>> = {
    srcAddress: (v) => validPrefix(v.replace(/^!/, "")),
    dstAddress: (v) => validPrefix(v.replace(/^!/, "")),
    toAddresses: (v) => validPrefix(v),
    srcPort: (v) => /^!?[\d,\- ]+$/.test(v),
    dstPort: (v) => /^!?[\d,\- ]+$/.test(v),
    toPorts: (v) => /^\d+(-\d+)?$/.test(v),
  };
  const info = TABLE_INFO[table];
  const set = (k: RuleKey, v: string | boolean | undefined) => onChange({ ...rule, [k]: v === "" ? undefined : v });
  const params = paramsFor(rule.action);
  const portless = rule.protocol && !["tcp", "udp", "6", "17"].includes(rule.protocol);

  return (
    <div className="ruleform">
      <div className="grid2">
        <Field label="chain" value={rule.chain} options={info.chains} onChange={(v) => set("chain", v)} />
        <Field
          label="action"
          value={rule.action}
          options={info.actions}
          onChange={(v) => onChange({ ...rule, action: v, passthrough: paramsFor(v).includes("passthrough") ? rule.passthrough ?? true : undefined })}
        />
      </div>
      <h5>Match</h5>
      <div className="grid2">
        {matchersFor(table).map((k) => (
          <Field
            key={k}
            label={rosName(k)}
            value={rule[k] as string | undefined}
            suggestions={sugg[k]}
            mono
            disabled={(k === "srcPort" || k === "dstPort") && !!portless}
            invalid={!!validate[k] && !!rule[k] && !validate[k]!(String(rule[k]))}
            hint={k === "srcPort" || k === "dstPort" ? "Needs protocol tcp or udp" : undefined}
            onChange={(v) => set(k, v)}
          />
        ))}
      </div>
      {params.length > 0 && (
        <>
          <h5>Action</h5>
          <div className="grid2">
            {params.map((k) =>
              k === "passthrough" ? (
                <Toggle key={k} label="passthrough" checked={rule.passthrough !== false} onChange={(v) => set(k, v)} />
              ) : (
                <Field
                  key={k}
                  label={rosName(k)}
                  value={rule[k] as string | undefined}
                  suggestions={sugg[k]}
                  mono
                  invalid={!!validate[k] && !!rule[k] && !validate[k]!(String(rule[k]))}
                  onChange={(v) => set(k, v)}
                />
              ),
            )}
          </div>
        </>
      )}
      <div className="grid2">
        <Field label="comment" value={rule.comment} wide onChange={(v) => set("comment", v)} />
      </div>
    </div>
  );
}

export default function RulesEditor({ table, chain }: { table: Table; chain: string }) {
  const all = useSim((s) => s.cfg.rules[table]);
  const hits = useSim((s) => s.hits);
  const setCfg = useSim((s) => s.setCfg);
  const lastEval = useSim((s) => {
    // which rule matched/was checked in the currently shown step
    const st = s.result?.steps[s.step];
    return st?.stages?.find((x) => x.table === table && x.chain === chain)?.evals;
  });
  const [open, setOpen] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdMsg, setCmdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [wizard, setWizard] = useState(false);
  const rules = all.map((r, i) => ({ r, i })).filter(({ r }) => r.chain === chain);
  const info = TABLE_INFO[table];

  const update = (fn: (rules: Rule[]) => Rule[]) => setCfg((c) => void (c.rules[table] = fn(c.rules[table])));
  const move = (i: number, dir: -1 | 1) =>
    update((rs) => {
      const same = rs.map((r, j) => ({ r, j })).filter(({ r }) => r.chain === chain).map(({ j }) => j);
      const pos = same.indexOf(i);
      const other = same[pos + dir];
      if (other === undefined) return rs;
      const out = [...rs];
      [out[i], out[other]] = [out[other], out[i]];
      return out;
    });

  const add = () => {
    const rule: Rule = { id: newId(), chain, action: info.actions[0] };
    if (paramsFor(rule.action).includes("passthrough")) rule.passthrough = true;
    update((rs) => [...rs, rule]);
    setOpen(rule.id);
  };

  const applyCmd = () => {
    const lines = cmd.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const added: { table: Table; rule: Rule }[] = [];
    for (const [n, line] of lines.entries()) {
      const res = parseRuleCommand(line.includes("chain=") ? line : `${line} chain=${chain}`, table);
      if ("error" in res) return setCmdMsg({ ok: false, text: `Line ${n + 1}: ${res.error}` });
      added.push(res);
    }
    setCfg((c) => added.forEach(({ table: t, rule }) => c.rules[t].push(rule)));
    setCmd("");
    setCmdMsg({ ok: true, text: `Added ${added.length} rule${added.length === 1 ? "" : "s"}.` });
  };

  return (
    <div className="rules">
      <div className="menu-path mono">{info.menu} · chain={chain}</div>
      {rules.length === 0 && <p className="muted small">No rules. Packets pass this hook with the default action: accept.</p>}
      <ol className="rulelist">
        {rules.map(({ r, i }, k) => {
          const ev = lastEval?.find((e) => e.ruleId === r.id);
          const cls = ["rule", r.disabled && "off", ev?.matched && "hit", ev && !ev.matched && "miss", open === r.id && "open"].filter(Boolean).join(" ");
          return (
            <li key={r.id} className={cls}>
              <div className="rule-row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="rule-n">{i}</span>
                <span className={`act act-${r.action}`}>{r.action}</span>
                <span className="rule-txt mono">
                  {r.comment && <span className="rule-comment">;;; {r.comment}</span>}
                  {formatRule({ ...r, chain: "", action: "", comment: undefined, disabled: false }) || "any packet"}
                </span>
                <span className="rule-hits" title="Packets matched in this session">{hits[r.id] ?? 0}</span>
              </div>
              {open === r.id && (
                <div className="rule-edit">
                  <RuleForm table={table} rule={r} onChange={(nr) => update((rs) => rs.map((x) => (x.id === r.id ? nr : x)))} />
                  <div className="rule-tools">
                    <button className="btn sm" onClick={() => move(i, -1)} disabled={k === 0}>↑ Up</button>
                    <button className="btn sm" onClick={() => move(i, 1)} disabled={k === rules.length - 1}>↓ Down</button>
                    <button className="btn sm" onClick={() => update((rs) => rs.map((x) => (x.id === r.id ? { ...x, disabled: !x.disabled } : x)))}>
                      {r.disabled ? "Enable" : "Disable"}
                    </button>
                    <button className="btn sm" onClick={() => update((rs) => { const j = rs.findIndex((x) => x.id === r.id); const out = [...rs]; out.splice(j + 1, 0, { ...r, id: newId() }); return out; })}>Copy</button>
                    <span className="sp" />
                    <button className="btn sm danger" onClick={() => update((rs) => rs.filter((x) => x.id !== r.id))}>Remove</button>
                  </div>
                </div>
              )}
              {ev && !ev.matched && ev.why && <div className="rule-why">✗ {ev.why}</div>}
              {ev?.matched && <div className="rule-why hit">✓ matched: {ev.action}</div>}
            </li>
          );
        })}
      </ol>
      <button className="btn ghost add" onClick={add}>+ Add rule</button>
      {table === "nat" && chain === "dstnat" && (
        <div className="wizard-wrap">
          <button className="btn sm" onClick={() => setWizard(!wizard)}>{wizard ? "Close" : "⚡ Port-forward wizard"}</button>
          {wizard && <PortForwardWizard onDone={() => setWizard(false)} />}
        </div>
      )}
      <div className="cmdbox">
        <label className="small muted" htmlFor={`cmd-${table}-${chain}`}>Or paste RouterOS commands (one per line)</label>
        <textarea
          id={`cmd-${table}-${chain}`}
          className="mono"
          rows={2}
          value={cmd}
          placeholder={`${info.menu} add chain=${chain} action=${info.actions[0]} …`}
          onChange={(e) => { setCmd(e.target.value); setCmdMsg(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) applyCmd(); }}
          spellCheck={false}
        />
        <div className="cmdbar">
          {cmdMsg && <span className={cmdMsg.ok ? "ok small" : "err small"}>{cmdMsg.text}</span>}
          <span className="sp" />
          <button className="btn sm" onClick={applyCmd} disabled={!cmd.trim()}>Add from command</button>
        </div>
      </div>
    </div>
  );
}
