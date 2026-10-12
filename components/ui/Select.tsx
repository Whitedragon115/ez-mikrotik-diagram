"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Option = string | { value: string; label?: string; hint?: string };
const norm = (o: Option) => (typeof o === "string" ? { value: o, label: o || "—" } : { label: o.value || "—", ...o });

/** Positions a popover (portal, position: fixed) under an anchor and closes on outside click. */
function usePopover(open: boolean, close: () => void) {
  const anchor = useRef<HTMLElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const below = window.innerHeight - a.bottom - 8;
    const above = a.top - 8;
    const up = below < 200 && above > below;
    setPos({ left: a.left, top: up ? a.top - 4 : a.bottom + 4, width: a.width, maxH: Math.min(300, up ? above : below), up });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (pop.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  return { anchor, pop, pos };
}

function Menu({
  id, items, active, setActive, onPick, pos, popRef, children,
}: {
  id: string;
  items: { value: string; label: string; hint?: string }[];
  active: number;
  setActive: (i: number) => void;
  onPick: (v: string) => void;
  pos: { left: number; top: number; width: number; maxH: number; up: boolean };
  popRef: React.RefObject<HTMLDivElement | null>;
  children?: ReactNode;
  selected?: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = list.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return createPortal(
    <div
      ref={popRef}
      className="dd-pop no-canvas"
      style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxH, transform: pos.up ? "translateY(-100%)" : undefined }}
    >
      {children}
      <ul ref={list} role="listbox" id={id}>
        {items.length === 0 && <li className="dd-empty">No matches</li>}
        {items.map((o, i) => (
          <li
            key={o.value + i}
            role="option"
            aria-selected={i === active}
            className={[i === active && "on", o.hint && "has-hint"].filter(Boolean).join(" ") || undefined}
            onPointerEnter={() => setActive(i)}
            onPointerDown={(e) => {
              e.preventDefault();
              onPick(o.value);
            }}
          >
            <span>{o.label}</span>
            {o.hint && <small>{o.hint}</small>}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

interface SelectProps {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Custom dropdown: button + searchable listbox. */
export function Select({ value, options, onChange, disabled, placeholder = "Select…", className }: SelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => options.map(norm), [options]);
  const items = useMemo(() => (q ? all.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : all), [all, q]);
  const [active, setActive] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const { anchor, pop, pos } = usePopover(open, close);
  const current = all.find((o) => o.value === value);
  const searchable = all.length > 8;

  const openMenu = () => {
    if (disabled) return;
    setQ("");
    setActive(Math.max(0, all.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    (anchor.current as HTMLButtonElement | null)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[active]) pick(items[active].value); }
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        ref={anchor as React.RefObject<HTMLButtonElement>}
        className={["dd-btn", open && "open", className].filter(Boolean).join(" ")}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
      >
        <span className={current ? undefined : "muted"}>{current ? current.label : value || placeholder}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      {open && pos && (
        <Menu id={id} items={items} active={active} setActive={setActive} onPick={pick} pos={pos} popRef={pop}>
          {searchable && (
            <input
              className="dd-search"
              autoFocus
              placeholder="Search…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey}
            />
          )}
        </Menu>
      )}
    </>
  );
}

interface ComboProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/** Text input with a custom suggestion dropdown (replaces <datalist>). */
export function Combo({ value, onChange, suggestions, placeholder, className, disabled }: ComboProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const close = useCallback(() => setOpen(false), []);
  const { anchor, pop, pos } = usePopover(open, close);
  const items = useMemo(() => {
    const q = value.toLowerCase();
    const hits = suggestions.filter((s) => s.toLowerCase().includes(q) && s !== value);
    return (hits.length || !q ? hits : []).slice(0, 50).map((s) => ({ value: s, label: s }));
  }, [suggestions, value]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && open && items[active]) { e.preventDefault(); onChange(items[active].value); setOpen(false); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <>
      <input
        ref={anchor as React.RefObject<HTMLInputElement>}
        className={className}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-autocomplete="list"
        onFocus={() => { setOpen(true); setActive(-1); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKey}
      />
      {open && pos && items.length > 0 && (
        <Menu id={id} items={items} active={active} setActive={setActive} onPick={(v) => { onChange(v); setOpen(false); }} pos={pos} popRef={pop} />
      )}
    </>
  );
}
