"use client";

import { memo, useMemo, type CSSProperties, type Ref } from "react";
import { EDGES, LAYER_BOXES, LAYERS, NODES, byId, edgeKey, nodeColor, plain, type Edge, type FlowNode } from "@/lib/flow";
import { MPLS_NODES } from "@/lib/sim/nodes";
import FlowShape from "../FlowShape";

interface Props {
  path: string[] | null;
  step: number;
  status: Record<number, "drop" | "done" | "warn" | undefined>;
  selected: string | null;
  counts: Record<string, number>;
  onNodeClick: (id: string) => void;
  dotRef: Ref<SVGGElement>;
}

function edgeLabel([, , pts, lab]: Edge) {
  if (!lab) return null;
  const [a, b] = pts;
  const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
  if (dy) return <text x={a[0] + 6} y={a[1] + (dy > 0 ? 13 : -5)}>{lab}</text>;
  return <text x={a[0] + (dx > 0 ? 5 : -5)} y={a[1] - 5} textAnchor={dx > 0 ? "start" : "end"}>{lab}</text>;
}

function Label({ n }: { n: FlowNode }) {
  const lines = n.t.split("\n");
  const lh = 12.5;
  const y0 = n.y - (lines.length * lh + (n.sub ? 11 : 0)) / 2 + lh - 3;
  return (
    <>
      {lines.map((ln, i) => (
        <text key={i} x={n.x} y={y0 + i * lh} textAnchor="middle">{ln}</text>
      ))}
      {n.sub && <text className="s" x={n.x} y={y0 + lines.length * lh - 1} textAnchor="middle">{n.sub}</text>}
    </>
  );
}

/** Static parts (layers, edges, nodes) — re-rendered only when the trace or selection changes. */
const FlowGraph = memo(function FlowGraph({ path, step, status, selected, counts, onNodeClick, dotRef }: Props) {
  const { onNodes, past, onEdges, pastEdges, badges } = useMemo(() => {
    const onNodes = new Set<string>(), past = new Set<string>(), onEdges = new Set<string>(), pastEdges = new Set<string>();
    const nums: Record<string, number[]> = {};
    path?.forEach((id, i) => {
      onNodes.add(id);
      if (i <= step) past.add(id);
      (nums[id] ??= []).push(i + 1);
      const next = path[i + 1];
      if (next) {
        onEdges.add(edgeKey(id, next));
        if (i < step) pastEdges.add(edgeKey(id, next));
      }
    });
    return { onNodes, past, onEdges, pastEdges, badges: Object.entries(nums) };
  }, [path, step]);

  const current = path?.[step];
  const endIdx = path ? path.length - 1 : -1;
  const endStatus = status[endIdx];

  return (
    <g className={path ? "graph tracing" : "graph"}>
      <defs>
        {[["arr", "var(--line)"], ["arrOn", "var(--accent)"]].map(([id, c]) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: c }} />
          </marker>
        ))}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {LAYER_BOXES.map(([x, y, w, h, label, k]) => (
        <g className="layer" key={k}>
          <rect x={x} y={y} width={w} height={h} rx={14} style={{ fill: `var(--${k}-tint)`, stroke: `var(--${k})` }} />
          <text x={x + w - 12} y={y + h - 12} textAnchor="end" style={{ fill: `var(--${k})` }}>{label}</text>
        </g>
      ))}

      {EDGES.map((e) => {
        const key = edgeKey(e[0], e[1]);
        const cls = ["edge", onEdges.has(key) && "on", pastEdges.has(key) && "past"].filter(Boolean).join(" ");
        return (
          <g key={key} className={cls}>
            <path d={"M" + e[2].map((p) => p.join(",")).join(" L")} markerEnd={onEdges.has(key) ? "url(#arrOn)" : "url(#arr)"} />
            {edgeLabel(e)}
          </g>
        );
      })}

      {NODES.map((n) => {
        const cls = [
          "node", n.s,
          onNodes.has(n.id) && "on", past.has(n.id) && "past", current === n.id && "cur", selected === n.id && "sel",
          MPLS_NODES.has(n.id) && "muted",
        ].filter(Boolean).join(" ");
        const style = { "--c": `var(${nodeColor(n)})`, "--cf": `var(${LAYERS[n.L].f ?? "--node"})` } as CSSProperties;
        const count = counts[n.id];
        return (
          <g
            key={n.id}
            className={cls}
            style={style}
            data-id={n.id}
            onClick={() => onNodeClick(n.id)}
            role="button"
            tabIndex={0}
            aria-label={plain(n.t)}
            onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onNodeClick(n.id)}
          >
            <FlowShape s={n.s} x={n.x} y={n.y} w={n.w} h={n.h} />
            <Label n={n} />
            {count > 0 && (
              <g className="count">
                <rect x={n.x - n.w / 2 - 6} y={n.y - n.h / 2 - 9} width={String(count).length * 6 + 12} height={15} rx={7.5} />
                <text x={n.x - n.w / 2 - 6 + (String(count).length * 6 + 12) / 2} y={n.y - n.h / 2 + 2} textAnchor="middle">{count}</text>
              </g>
            )}
          </g>
        );
      })}

      {badges.map(([id, arr]) => {
        const n = byId[id];
        const label = arr.length > 3 ? `${arr[0]}…${arr[arr.length - 1]}` : arr.join("·");
        const w = Math.max(18, label.length * 6 + 8);
        const bx = n.s === "decision" ? n.x + n.w / 4 + 4 : n.x + n.w / 2 - 4;
        const by = n.s === "decision" ? n.y - n.h / 4 - 6 : n.y - n.h / 2;
        return (
          <g key={id} className={past.has(id) ? "badge past" : "badge"}>
            <rect x={bx - w / 2} y={by - 9} width={w} height={18} rx={9} />
            <text x={bx} y={by + 3.5} textAnchor="middle">{label}</text>
          </g>
        );
      })}

      {path && endStatus && step === endIdx && (() => {
        const n = byId[path[endIdx]];
        return (
          <g className={`endmark ${endStatus}`} transform={`translate(${n.x},${n.y + n.h / 2 + 16})`}>
            <circle r={13} />
            <text y={5} textAnchor="middle">{endStatus === "drop" ? "✕" : "✓"}</text>
          </g>
        );
      })()}

      <g ref={dotRef} style={{ display: path ? undefined : "none" }}>
        <circle className="dot-halo" r={16} filter="url(#glow)" />
        <circle className="dot" r={6.5} />
      </g>
    </g>
  );
});

export default FlowGraph;
