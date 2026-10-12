"use client";

import { useEffect, useRef, useState } from "react";
import { useSim, type WinRect } from "@/lib/store";
import { byId, plain } from "@/lib/flow";
import PacketView from "./PacketView";

const MIN_W = 260;
const MIN_H = 180;
const MARGIN = 8;

/** keep the window on screen (at least its title bar) */
function clamp(r: WinRect): WinRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(MIN_W, r.w), vw - MARGIN * 2);
  const h = Math.min(Math.max(MIN_H, r.h), vh - MARGIN * 2);
  return { w, h, x: Math.min(Math.max(MARGIN, r.x), vw - w - MARGIN), y: Math.min(Math.max(MARGIN, r.y), vh - 40) };
}

/** first-time spot: bottom right, just above the trace panel */
function defaultRect(traceH: number): WinRect {
  const top = 68; // below the top bar
  const w = 360;
  const h = Math.max(MIN_H, Math.min(420, window.innerHeight - traceH - top - 36));
  return clamp({ w, h, x: window.innerWidth - w - 24, y: Math.max(top, window.innerHeight - traceH - h - 36) });
}

/** Free-floating packet inspector: drag it by its title bar, resize from the corner, close with ✕. */
export default function PacketWindow() {
  const open = useSim((s) => s.pktWin.open);
  const saved = useSim((s) => s.pktWin.rect);
  const traceH = useSim((s) => s.layout.traceH);
  const result = useSim((s) => s.result);
  const step = useSim((s) => s.step);
  const setPktWin = useSim((s) => s.setPktWin);
  const [rect, setRect] = useState<WinRect | null>(null);
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; start: WinRect } | null>(null);

  // place it once the window size is known, and keep it on screen when the browser resizes
  useEffect(() => {
    if (!open) return;
    setRect(saved ? clamp(saved) : defaultRect(traceH));
    const onResize = () => setRect((r) => (r ? clamp(r) : r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !rect) return null;

  const steps = result?.steps ?? [];
  const cur = steps[step];
  const prev = steps[step - 1];

  const begin = (mode: "move" | "size") => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (mode === "move" && (e.target as Element).closest("button"))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: rect };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setRect(clamp(d.mode === "move" ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, w: d.start.w + dx, h: d.start.h + dy }));
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPktWin({ rect }); // remember it for next time
  };

  return (
    <section className="pktwin no-canvas" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} aria-label="Packet inspector">
      <header className="pktwin-head" onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end}>
        <b>Packet inspector</b>
        <span className="muted small">{cur ? `step ${step + 1} · ${plain(byId[cur.node].t)}` : "no packet yet"}</span>
        <span className="sp" />
        <button className="icon" onClick={() => setPktWin({ open: false })} title="Close (reopen from the trace panel)">✕</button>
      </header>
      <div className="pktwin-body">
        {cur ? <PacketView cur={cur.pkt} prev={prev?.pkt} step={step} /> : <div className="empty">Send a packet to see its headers change step by step.</div>}
      </div>
      <div className="pktwin-grip" onPointerDown={begin("size")} onPointerMove={move} onPointerUp={end} title="Drag to resize" aria-hidden />
    </section>
  );
}
