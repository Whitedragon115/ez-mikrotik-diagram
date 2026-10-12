"use client";

import { useMemo } from "react";
import { useSim } from "@/lib/store";
import { byId } from "@/lib/flow";
import { explain } from "@/lib/sim/explain";
import { TABLE_INFO } from "@/lib/sim/rules";
import type { View } from "./Canvas";

const W = 330;
const TONE_LABEL = { yes: "YES", no: "NO", drop: "DROPPED", done: "DONE", change: "CHANGED", info: "PASS" } as const;

interface Props {
  view: View;
  insets: { left: number; right: number; top: number; bottom: number };
}

/** Explanation card anchored next to the packet's current node. */
export default function Callout({ view, insets }: Props) {
  const result = useSim((s) => s.result);
  const step = useSim((s) => s.step);
  const cfg = useSim((s) => s.cfg);
  const show = useSim((s) => s.explain);
  const playing = useSim((s) => s.playing);
  const { setStep, setPlaying, setExplain, select } = useSim.getState();

  const cur = result?.steps[step];
  const d = useMemo(() => cur && explain(cur, result!.steps[step - 1], cfg), [cur, result, step, cfg]);
  if (!result || !cur || !d || !show) return null;

  const n = byId[cur.node];
  const last = result.steps.length - 1;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const right = (n.x + n.w / 2) * view.k + view.x + 18;
  const leftSide = (n.x - n.w / 2) * view.k + view.x - 18 - W;
  const x = right + W > vw - insets.right - 8 && leftSide > insets.left + 8 ? leftSide : Math.min(right, vw - insets.right - W - 8);
  // cap the height to the free space above the trace panel; the middle part scrolls
  const avail = vh - insets.bottom - insets.top - 16;
  const maxH = Math.max(180, Math.min(460, avail));
  const y = Math.max(insets.top + 8, Math.min((n.y - n.h / 2) * view.k + view.y - 10, vh - insets.bottom - 8 - maxH));
  const go = (i: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className={`callout no-canvas tone-${d.tone}`} style={{ left: x, top: y, width: W, maxHeight: maxH }}>
      <div className="co-head">
        <span className="co-step">Step {step + 1}/{result.steps.length}</span>
        <span className={`co-tone t-${d.tone}`}>{TONE_LABEL[d.tone]}</span>
        <span className="sp" />
        <button className="icon sm" onClick={() => setExplain(false)} title="Hide explanations">✕</button>
      </div>
      <div className="co-title">{d.title}</div>
      <div className="co-scroll" onWheel={(e) => e.stopPropagation()}>
      <div className="co-headline">{d.headline}</div>

      {d.rules.length > 0 && (
        <div className="co-rules">
          {d.rules.map((r, i) => (
            <button key={i} className={r.final ? "co-rule final" : "co-rule"} onClick={() => select(cur.node)} title="Open this rule's chain">
              <div className="co-rule-top">
                <span className="co-where">{TABLE_INFO[r.table].menu.replace("/ip firewall ", "").replace("/interface ", "")} · {r.chain} · #{r.index}</span>
                <span className={`act act-${r.action}`}>{r.action}</span>
              </div>
              {r.comment && <div className="co-comment">;;; {r.comment}</div>}
              <code className="co-code">{r.text}</code>
              {r.result && r.result !== r.action && <div className="co-result">→ {r.result}</div>}
            </button>
          ))}
        </div>
      )}

      {d.changes.length > 0 && (
        <ul className="co-changes">
          {d.changes.map((c, i) => <li key={i} className="mono">{c}</li>)}
        </ul>
      )}
      {d.facts.length > 0 && (
        <ul className="co-facts">
          {d.facts.slice(0, 4).map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}

      </div>
      <div className="co-nav">
        <button className="btn sm" onClick={() => go(step - 1)} disabled={step === 0}>◀ Back</button>
        <button className="btn sm" onClick={() => setPlaying(!playing)} disabled={step === last} title="Auto-play (pauses briefly at each step)">
          {playing ? "⏸ Pause" : "Auto"}
        </button>
        <span className="sp" />
        {step < last ? (
          <button className="btn sm primary" onClick={() => go(step + 1)}>Next step ▶</button>
        ) : (
          <span className={`co-end t-${d.tone}`}>{result.verdict.text}</span>
        )}
      </div>
    </div>
  );
}
