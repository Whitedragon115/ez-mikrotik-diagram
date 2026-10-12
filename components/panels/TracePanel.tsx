"use client";

import { useEffect, useRef, useState } from "react";
import { useSim } from "@/lib/store";
import { byId, plain } from "@/lib/flow";
import { formatRule } from "@/lib/sim/rules";
import { decisionTag, explain } from "@/lib/sim/explain";
import Resizer from "../ui/Resizer";
import { DEFAULT_LAYOUT } from "@/lib/store";
import type { StageResult } from "@/lib/sim/types";

const NO_RULES: never[] = [];

function Stage({ s }: { s: StageResult }) {
  const rules = useSim((st) => (s.table ? st.cfg.rules[s.table] : NO_RULES));
  return (
    <div className={`stage-card k-${s.kind}`}>
      <div className="stage-top">
        <b>{s.name}</b>
        <span className="stage-res">{s.result}</span>
      </div>
      {s.evals.length > 0 && (
        <ol className="evals">
          {s.evals.map((e) => {
            const r = rules.find((x) => x.id === e.ruleId);
            return (
              <li key={e.ruleId} className={e.matched ? "m" : ""}>
                <span className="rule-n">{e.index}</span>
                <span className="mono ev-rule">{r ? `action=${r.action} ${formatRule({ ...r, chain: "", action: "", comment: undefined, disabled: false })}` : "(rule deleted)"}</span>
                <span className="ev-why">{e.matched ? `✓ ${e.action}` : `✗ ${e.why}`}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function TracePanel() {
  const result = useSim((s) => s.result);
  const step = useSim((s) => s.step);
  const playing = useSim((s) => s.playing);
  const conntrack = useSim((s) => s.conntrack);
  const cfg = useSim((s) => s.cfg);
  const { setStep, setPlaying, setTrace, select, clearConnections, reply } = useSim.getState();
  const open = useSim((s) => s.trace);
  const pktOpen = useSim((s) => s.pktWin.open);
  const [tab, setTab] = useState<"steps" | "conns">("steps");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const li = list?.children[step] as HTMLElement | undefined;
    if (!list || !li) return;
    if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop - 4;
    else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight + 4;
  }, [step]);

  if (!open) return null;
  const steps = result?.steps ?? [];
  const cur = steps[step];
  const prev = steps[step - 1];
  const last = steps.length - 1;
  const go = (i: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(last, i)));
  };

  return (
    <section className="panel trace no-canvas">
      <Resizer edge="top" label="Resize trace" value={() => useSim.getState().layout.traceH} min={140} max={() => window.innerHeight - 180} reset={DEFAULT_LAYOUT.traceH} onChange={(v) => useSim.getState().setLayout({ traceH: v })} />
      <div className="trace-head">
        <div className="tabs">
          <button className={tab === "steps" ? "tab on" : "tab"} onClick={() => setTab("steps")}>Trace</button>
          <button className={tab === "conns" ? "tab on" : "tab"} onClick={() => setTab("conns")}>
            Connections <span className="pill">{conntrack.length}</span>
          </button>
        </div>
        {result && (
          <>
            <div className="player">
              <button className="icon" onClick={() => go(0)} title="First step">⏮</button>
              <button className="icon" onClick={() => go(step - 1)} disabled={step === 0} title="Previous (←)">◀</button>
              <button className="icon play" onClick={() => (playing ? setPlaying(false) : (step >= last && setStep(0), setPlaying(true)))} title="Play / pause (space)">
                {playing ? "⏸" : "▶"}
              </button>
              <button className="icon" onClick={() => go(step + 1)} disabled={step === last} title="Next (→)">▶</button>
              <button className="icon" onClick={() => go(last)} title="Last step">⏭</button>
              <span className="muted small">{step + 1} / {steps.length}</span>
            </div>
            <div className={`verdict v-${result.verdict.kind}`}>{result.verdict.text}</div>
          </>
        )}
        <span className="sp" />
        <button className={pktOpen ? "btn sm on" : "btn sm"} onClick={() => useSim.getState().setPktWin({ open: !pktOpen })} title="Show or hide the floating packet inspector">
          Packet inspector
        </button>
        <button className="icon" onClick={() => setTrace(false)} title="Hide">▾</button>
      </div>

      {tab === "steps" &&
        (result ? (
          <div className="trace-body">
            <ol className="steplist" ref={listRef}>
              {steps.map((s, i) => (
                <li key={i} className={[i === step && "cur", s.status].filter(Boolean).join(" ")} onClick={() => go(i)} onDoubleClick={() => select(s.node)}>
                  <span className="num">{i + 1}</span>
                  <span className="st-name">{plain(byId[s.node].t)}</span>
                  {s.outcome && <span className={`ans ${s.outcome}`}>{s.outcome}</span>}
                  {s.status === "drop" && <span className="ans drop">drop</span>}
                  {(() => {
                    const tag = decisionTag(s);
                    return tag && s.status !== "drop" ? <span className="ruletag">{tag}</span> : null;
                  })()}
                  {s.stages?.some((x) => x.kind === "change") && <span className="dotmark" title="packet changed here" />}
                </li>
              ))}
            </ol>
            {cur && (
              <div className="stepdetail">
                <div className="sd-head">
                  <h3>{plain(byId[cur.node].t)}</h3>
                  <button className="btn sm" onClick={() => select(cur.node)}>Edit rules here</button>
                </div>
                {(() => {
                  const d = explain(cur, prev, cfg);
                  return <div className={`why tone-${d.tone}`}><b>Why:</b> {d.headline}{d.rules.filter((r) => r.final).map((r, i) => <span key={i} className="mono"> ← {r.table} {r.chain} #{r.index} {r.action}</span>)}</div>;
                })()}
                {cur.notes.map((n, i) => (
                  <p key={i} className={cur.status === "drop" && i === cur.notes.length - 1 ? "note err" : "note"}>{n}</p>
                ))}
                {cur.stages?.map((s, i) => <Stage key={i} s={s} />)}

              </div>
            )}
          </div>
        ) : (
          <div className="empty">Pick a preset or press <b>Send packet</b> in the Packet panel to simulate.</div>
        ))}

      {tab === "conns" && (
        <div className="conns">
          <div className="cmdbar">
            <span className="muted small">/ip firewall connection print</span>
            <span className="sp" />
            <button className="btn sm" onClick={reply} disabled={!result?.final || result.verdict.kind === "dropped"}>↩ Send reply to last packet</button>
            <button className="btn sm" onClick={clearConnections} disabled={!conntrack.length}>Clear table</button>
          </div>
          {conntrack.length === 0 ? (
            <div className="empty">No tracked connections yet.</div>
          ) : (
            <table className="conntable">
              <thead>
                <tr><th>#</th><th>Proto</th><th>Src</th><th>Dst</th><th>Reply src → dst</th><th>NAT</th><th>State</th><th>Mark</th><th>Pkts</th></tr>
              </thead>
              <tbody>
                {conntrack.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.proto}</td>
                    <td className="mono">{c.orig.src}{c.orig.sport ? `:${c.orig.sport}` : ""}</td>
                    <td className="mono">{c.orig.dst}{c.orig.dport ? `:${c.orig.dport}` : ""}</td>
                    <td className="mono">{c.reply.src}{c.reply.sport ? `:${c.reply.sport}` : ""} → {c.reply.dst}{c.reply.dport ? `:${c.reply.dport}` : ""}</td>
                    <td>{[c.snat && "srcnat", c.dnat && "dstnat"].filter(Boolean).join(", ") || "—"}</td>
                    <td>{c.seenReply ? "established" : "new (unreplied)"}</td>
                    <td>{c.connMark ?? "—"}</td>
                    <td>{c.packets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
