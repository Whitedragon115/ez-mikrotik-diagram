"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface CanvasApi {
  fit: () => void;
  zoomBy: (f: number) => void;
  /** pan so that the world point is visible (centered if it is off-screen or `force`) */
  reveal: (wx: number, wy: number, force?: boolean) => void;
  /** true when the last pointer gesture was a drag (so clicks can be ignored) */
  wasDrag: () => boolean;
  /**
   * Camera lock: move the view so the world point stays at the same screen spot as the previously
   * followed point. If the user panned/zoomed in between, the new screen spot is kept: "it stays where you put it".
   */
  follow: (wx: number, wy: number) => void;
  /** forget the followed point (keeps its current screen spot as the anchor for the next follow) */
  resetFollow: () => void;
}

interface Props {
  world: { w: number; h: number };
  /** insets (px) occupied by floating panels, so fit/reveal use the visible area */
  insets: { left: number; right: number; top: number; bottom: number };
  children: ReactNode;
  overlay?: ReactNode;
  /** screen-space overlay that follows the view (e.g. a callout anchored to a node) */
  renderOverlay?: (view: View) => ReactNode;
}

const MIN = 0.12;
const MAX = 4;
const GRID = 24;
const clampK = (k: number) => Math.min(MAX, Math.max(MIN, k));

/** Infinite "drawing table": dot grid, drag to pan, wheel / pinch to zoom at the pointer. */
const Canvas = forwardRef<CanvasApi, Props>(function Canvas({ world, insets, children, overlay, renderOverlay }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; k: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const dragged = useRef(false);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const anim = useRef(0);
  const [panning, setPanning] = useState(false);
  const followPrev = useRef<[number, number] | null>(null);
  const anchor = useRef<[number, number] | null>(null);

  const zoomAt = useCallback((px: number, py: number, k2: number) => {
    setView((v) => {
      const k = clampK(k2);
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  const animateTo = useCallback((target: View) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const tick = (t: number) => {
      const u = Math.min(1, (t - t0) / 320);
      const e = 1 - Math.pow(1 - u, 3);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e });
      if (u < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  }, []);

  const visible = useCallback(() => {
    const r = el.current!.getBoundingClientRect();
    const w = Math.max(200, r.width - insets.left - insets.right);
    const h = Math.max(200, r.height - insets.top - insets.bottom);
    return { w, h, ox: insets.left, oy: insets.top };
  }, [insets]);

  const fitView = useCallback((): View => {
    const { w, h, ox, oy } = visible();
    const k = clampK(Math.min(w / world.w, h / world.h) * 0.94);
    return { k, x: ox + (w - world.w * k) / 2, y: oy + (h - world.h * k) / 2 };
  }, [visible, world]);

  useImperativeHandle(ref, () => ({
    fit: () => animateTo(fitView()),
    zoomBy: (f) => {
      const { w, h, ox, oy } = visible();
      const v = viewRef.current;
      const k = clampK(v.k * f);
      const px = ox + w / 2, py = oy + h / 2;
      animateTo({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
    },
    reveal: (wx, wy, force) => {
      const { w, h, ox, oy } = visible();
      const v = viewRef.current;
      const sx = wx * v.k + v.x, sy = wy * v.k + v.y;
      const m = 60;
      if (!force && sx > ox + m && sx < ox + w - m && sy > oy + m && sy < oy + h - m) return;
      animateTo({ k: v.k, x: ox + w / 2 - wx * v.k, y: oy + h / 2 - wy * v.k });
    },
    wasDrag: () => dragged.current,
    follow: (wx, wy) => {
      const v = viewRef.current;
      const { w, h, ox, oy } = visible();
      let a: [number, number];
      if (followPrev.current) a = [followPrev.current[0] * v.k + v.x, followPrev.current[1] * v.k + v.y];
      else a = anchor.current ?? [ox + w / 2, oy + h / 2];
      // keep the anchor inside the visible area, so the packet can't be locked off-screen
      const m = 40;
      a = [Math.min(ox + w - m, Math.max(ox + m, a[0])), Math.min(oy + h - m, Math.max(oy + m, a[1]))];
      anchor.current = a;
      followPrev.current = [wx, wy];
      const nv = { k: v.k, x: a[0] - wx * v.k, y: a[1] - wy * v.k };
      if (Math.abs(nv.x - v.x) < 0.01 && Math.abs(nv.y - v.y) < 0.01) return;
      cancelAnimationFrame(anim.current);
      viewRef.current = nv;
      setView(nv);
    },
    resetFollow: () => {
      const v = viewRef.current;
      if (followPrev.current) anchor.current = [followPrev.current[0] * v.k + v.x, followPrev.current[1] * v.k + v.y];
      followPrev.current = null;
    },
  }), [animateTo, fitView, visible]);

  // initial fit
  useEffect(() => {
    setView(fitView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // wheel: zoom at pointer (pinch on trackpads arrives as ctrl+wheel); shift+wheel pans
  useEffect(() => {
    const node = el.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest?.(".no-canvas")) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const r = node.getBoundingClientRect();
      if (e.shiftKey) {
        setView((v) => ({ ...v, x: v.x - (e.deltaY || e.deltaX), y: v.y }));
        return;
      }
      const scale = e.ctrlKey ? 0.01 : 0.0015;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, viewRef.current.k * Math.exp(-dy * scale));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // pointer: one pointer pans, two pointers pinch-zoom
  useEffect(() => {
    const node = el.current!;
    const local = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest(".no-canvas")) return;
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
      cancelAnimationFrame(anim.current);
      pointers.current.set(e.pointerId, local(e));
      dragged.current = false;
      downAt.current = local(e);
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const v = viewRef.current;
        gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: v.x, vy: v.y };
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pointers.current.set(e.pointerId, p);
      if (downAt.current && Math.hypot(p.x - downAt.current.x, p.y - downAt.current.y) > 4) {
        if (!dragged.current) setPanning(true);
        dragged.current = true;
      }
      if (pointers.current.size === 2 && gesture.current) {
        const [a, b] = [...pointers.current.values()];
        const g = gesture.current;
        const k = clampK((g.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        setView({ k, x: cx - ((g.cx - g.vx) * k) / g.k, y: cy - ((g.cy - g.vy) * k) / g.k });
      } else if (pointers.current.size === 1 && dragged.current) {
        setView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }));
      }
    };
    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) gesture.current = null;
      if (pointers.current.size === 0) setPanning(false);
    };
    node.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      node.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const g = GRID * view.k;
  return (
    <div
      ref={el}
      className={panning ? "canvas panning" : "canvas"}
      style={{
        backgroundSize: `${g}px ${g}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <svg className="canvas-svg">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>{children}</g>
      </svg>
      {renderOverlay?.(view)}
      {overlay}
      <div className="zoom-badge no-canvas">{Math.round(view.k * 100)}%</div>
    </div>
  );
});

export default Canvas;
