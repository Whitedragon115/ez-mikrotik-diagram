"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSim } from "@/lib/store";
import { NODES, VBH, VBW, buildRoute, byId, pointAt } from "@/lib/flow";
import { nodeCount } from "@/lib/sim/nodes";
import Canvas, { type CanvasApi } from "./canvas/Canvas";
import FlowGraph from "./canvas/FlowGraph";
import Callout from "./canvas/Callout";
import LeftPanel from "./panels/LeftPanel";
import Inspector from "./panels/Inspector";
import TracePanel from "./panels/TracePanel";
import ImportDialog from "./panels/ImportDialog";
import SaveDialog from "./panels/SaveDialog";
import ExportDialog from "./panels/ExportDialog";
import ThemeToggle from "./ThemeToggle";

const SPEED = 420; // world units per second

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(max-width: 900px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export default function Simulator() {
  const canvas = useRef<CanvasApi>(null);
  const dotRef = useRef<SVGGElement>(null);
  const { result, step, playing, selected, left, inspector, trace, cfg } = useSim(
    useShallow((s) => ({ result: s.result, step: s.step, playing: s.playing, selected: s.selected, left: s.left, inspector: s.inspector, trace: s.trace, cfg: s.cfg })),
  );
  const { setStep, setPlaying, select, setLeft, setTrace, setExplain } = useSim.getState();
  const explainOn = useSim((s) => s.explain);
  const savedRef = useSim((s) => s.savedRef);
  const narrow = useNarrow();
  const [follow, setFollow] = useState(true);

  // on phones the panels cover the canvas, so start with them closed
  useEffect(() => {
    if (narrow) {
      useSim.setState({ left: null, trace: false });
    }
    // the first fit ran with the desktop insets; re-fit once the layout is known
    const t = setTimeout(() => canvas.current?.fit(), 50);
    return () => clearTimeout(t);
  }, [narrow]);

  // back from Discord login: reopen the save dialog and show the result
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("login") && !q.has("save")) return;
    useSim.setState({ saveOpen: true, loginResult: q.get("login") });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // on phones, sending a packet hands the screen over to the canvas + callout
  useEffect(() => {
    if (narrow && result) useSim.setState({ left: null });
  }, [narrow, result]);

  const path = useMemo(() => result?.steps.map((s) => s.node) ?? null, [result]);
  const route = useMemo(() => (path ? buildRoute(path) : null), [path]);
  const status = useMemo(() => Object.fromEntries(result?.steps.map((s, i) => [i, s.status]) ?? []), [result]);
  const counts = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, nodeCount(cfg, n.id)])), [cfg]);
  const dist = useRef(0);

  const insets = useMemo(
    () =>
      narrow
        ? { left: 0, right: 0, top: 56, bottom: trace ? Math.round(window.innerHeight * 0.46) + 16 : 0 }
        : { left: left ? 372 : 0, right: inspector && selected ? 432 : 0, top: 64, bottom: trace ? 312 : 0 },
    [narrow, left, inspector, selected, trace],
  );

  const followRef = useRef(follow);
  followRef.current = follow;

  const placeDot = useCallback(() => {
    if (!route || !dotRef.current) return;
    const [x, y] = pointAt(route, dist.current);
    dotRef.current.setAttribute("transform", `translate(${x},${y})`);
    // camera lock: the dot keeps its screen position and the map moves underneath it
    if (followRef.current) canvas.current?.follow(x, y);
  }, [route]);

  // new result → rewind instantly (the dot keeps the screen spot it had)
  useEffect(() => {
    canvas.current?.resetFollow();
    dist.current = 0;
    placeDot();
  }, [route, placeDot]);

  // turning the lock on centres on the packet's current position; off frees the camera
  useEffect(() => {
    canvas.current?.resetFollow();
    if (follow) placeDot();
  }, [follow, placeDot]);

  // moving to a step tweens the dot there; while auto-playing, advance again after a short pause
  useEffect(() => {
    if (!route) return;
    const target = route.stepD[step] ?? 0;
    const from = dist.current;
    const span = Math.abs(target - from);
    const dur = Math.min(900, Math.max(140, (span / SPEED) * 1000));
    const lastIdx = route.stepD.length - 1;
    let raf = 0;
    let timer = 0;
    const t0 = performance.now();
    const done = () => {
      if (!playing) return;
      if (step >= lastIdx) return setPlaying(false);
      const st = useSim.getState().result?.steps[step];
      const decided = st?.outcome || st?.status || st?.stages?.some((x) => x.evals.some((e) => e.matched) || x.kind === "change");
      timer = window.setTimeout(() => setStep(step + 1), decided ? 1100 : 380);
    };
    const tick = (t: number) => {
      const u = Math.min(1, (t - t0) / dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      dist.current = from + (target - from) * e;
      placeDot();
      if (u < 1) raf = requestAnimationFrame(tick);
      else done();
    };
    if (span < 0.5) {
      dist.current = target;
      placeDot();
      done();
    } else raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [step, route, playing, placeDot, setStep, setPlaying]);


  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input,textarea,select,[contenteditable]")) return;
      const s = useSim.getState();
      const lastIdx = (s.result?.steps.length ?? 1) - 1;
      if (e.key === "ArrowRight" && s.result) { e.preventDefault(); setPlaying(false); setStep(Math.min(lastIdx, s.step + 1)); }
      else if (e.key === "ArrowLeft" && s.result) { e.preventDefault(); setPlaying(false); setStep(Math.max(0, s.step - 1)); }
      else if (e.key === " " && s.result) { e.preventDefault(); if (!s.playing && s.step >= lastIdx) setStep(0); setPlaying(!s.playing); }
      else if (e.key === "Escape") select(null);
      else if (e.key === "f") canvas.current?.fit();
      else if (e.key === "+" || e.key === "=") canvas.current?.zoomBy(1.25);
      else if (e.key === "-") canvas.current?.zoomBy(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, setPlaying, setStep]);

  const onNodeClick = useCallback(
    (id: string) => {
      if (canvas.current?.wasDrag()) return;
      select(useSim.getState().selected === id ? null : id);
    },
    [select],
  );

  return (
    <div className="app" data-left={left ? 1 : 0} data-right={inspector && selected ? 1 : 0} data-trace={trace ? 1 : 0}>
      <Canvas
        ref={canvas}
        world={{ w: VBW, h: VBH }}
        insets={insets}
        renderOverlay={(view) => <Callout view={view} insets={insets} />}
        overlay={
          <div className="zoombar no-canvas">
            <button className="icon" onClick={() => canvas.current?.zoomBy(1.25)} title="Zoom in (+)">+</button>
            <button className="icon" onClick={() => canvas.current?.zoomBy(0.8)} title="Zoom out (−)">−</button>
            <button className="icon" onClick={() => canvas.current?.fit()} title="Fit (F)">⤢</button>
            <button className={follow ? "icon on" : "icon"} onClick={() => setFollow(!follow)} title="Camera lock: keep the packet at the same spot on screen (drag the map to move that spot)">◎</button>
            <button className={explainOn ? "icon on" : "icon"} onClick={() => setExplain(!explainOn)} title="Show the decision callout">?</button>
          </div>
        }
      >
        <FlowGraph path={path} step={step} status={status} selected={selected} counts={counts} onNodeClick={onNodeClick} dotRef={dotRef} />
      </Canvas>

      <h1 className="sr-only">MikroTik Online Simulator &amp; Firewall Debugger</h1>
      <header className="topbar no-canvas">
        <div className="brand">
          <span className="logo">⇄</span>
          <div>
            <b>{cfg.identity}</b>
            <span className="muted"> · RouterOS packet flow simulator</span>
          </div>
        </div>
        <span className="sp" />
        <button className="btn" onClick={() => useSim.getState().setSaveOpen(true)} title={savedRef ? `Save / load (editing “${savedRef.name}”)` : "Save or load configurations"}>
          {savedRef ? `Save · ${savedRef.name.length > 18 ? savedRef.name.slice(0, 17) + "…" : savedRef.name}` : "Save / Load"}
        </button>
        <button className="btn" onClick={() => useSim.getState().setImportOpen(true)} title="Import a configuration from your MikroTik">Import</button>
        <button className="btn" onClick={() => useSim.setState({ exportOpen: true })} title="Export this setup (.rsc / .json) for re-importing here">Export</button>
        <button className={left === "packet" ? "btn on" : "btn"} onClick={() => setLeft(left === "packet" ? null : "packet")}>Packet</button>
        <button className={left === "router" ? "btn on" : "btn"} onClick={() => setLeft(left === "router" ? null : "router")}>Router</button>
        <button className={trace ? "btn on" : "btn"} onClick={() => setTrace(!trace)}>Trace</button>
        <button className="btn" onClick={() => window.open("/preview", "_blank", "noopener")} title="Open the configuration in a router-style UI">Preview config ↗</button>
        <ThemeToggle />
      </header>

      <LeftPanel />
      {inspector && <Inspector />}
      <TracePanel />
      <ImportDialog />
      <SaveDialog />
      <ExportDialog />
      {!result && !left && (
        <div className="hint-toast no-canvas">Drag to move · scroll to zoom · click a block to configure it</div>
      )}
    </div>
  );
}
