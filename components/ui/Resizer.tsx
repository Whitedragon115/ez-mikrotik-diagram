"use client";

import { useRef } from "react";

interface Props {
  /** which edge of the panel the handle sits on */
  edge: "top" | "left" | "right";
  /** current size, read when a drag starts */
  value: () => number;
  min: number;
  /** upper bound, read at drag time so it follows the window size */
  max: () => number;
  onChange: (v: number) => void;
  /** double-click restores this size */
  reset?: number;
  label: string;
}

/** A thin drag handle on a panel edge that changes the panel's width or height. */
export default function Resizer({ edge, value, min, max, onChange, reset, label }: Props) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const vertical = edge === "top";

  return (
    <div
      className={`resizer r-${edge}`}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      title={`${label} (double-click to reset)`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: vertical ? e.clientY : e.clientX, value: value() };
        document.body.classList.add(vertical ? "resizing-v" : "resizing-h");
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const pos = vertical ? e.clientY : e.clientX;
        // dragging away from the panel's inside makes it bigger
        const delta = edge === "right" ? pos - s.pos : s.pos - pos;
        onChange(Math.round(Math.min(max(), Math.max(min, s.value + delta))));
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove("resizing-v", "resizing-h");
      }}
      onDoubleClick={() => reset !== undefined && onChange(reset)}
    />
  );
}
