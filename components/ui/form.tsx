"use client";

import { type ReactNode } from "react";
import { Combo, Select } from "./Select";

interface FieldProps {
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  options?: string[];
  suggestions?: string[];
  invalid?: boolean;
  type?: "text" | "number" | "password";
  disabled?: boolean;
  mono?: boolean;
  wide?: boolean;
  hint?: string;
}

export function Field({ label, value, onChange, placeholder, options, suggestions, invalid, type = "text", disabled, mono, wide, hint }: FieldProps) {
  const cls = [invalid && "invalid", mono && "mono"].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["field", wide && "wide", disabled && "disabled"].filter(Boolean).join(" ")} title={hint}>
      <span>{label}</span>
      {options ? (
        <Select value={String(value ?? "")} options={options} onChange={onChange} disabled={disabled} className={mono ? "mono" : undefined} />
      ) : suggestions ? (
        <Combo value={String(value ?? "")} suggestions={suggestions} onChange={onChange} placeholder={placeholder} disabled={disabled} className={cls} />
      ) : (
        <input
          className={cls}
          value={value ?? ""}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

export interface ColDef<T> {
  key: keyof T & string;
  label: string;
  type?: "text" | "number" | "bool";
  options?: string[];
  suggestions?: string[];
  placeholder?: string;
  validate?: (v: string) => boolean;
  show?: (row: T) => boolean;
  wide?: boolean;
  mono?: boolean;
}

interface RowsProps<T> {
  rows: T[];
  cols: ColDef<T>[];
  onChange: (rows: T[]) => void;
  newRow: () => T;
  title: (row: T, i: number) => ReactNode;
  addLabel?: string;
  empty?: string;
}

/** Card-per-row list editor that fits narrow side panels. */
export function RowsEditor<T extends object>({ rows, cols, onChange, newRow, title, addLabel = "Add", empty }: RowsProps<T>) {
  const set = (i: number, k: keyof T, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="rows">
      {rows.length === 0 && empty && <p className="muted small">{empty}</p>}
      {rows.map((row, i) => {
        const disabled = (row as { disabled?: boolean }).disabled;
        return (
          <div className={disabled ? "rowcard off" : "rowcard"} key={i}>
            <div className="rowhead">
              <span className="rowtitle">{title(row, i)}</span>
              <button className="icon" title={disabled ? "Enable" : "Disable"} onClick={() => set(i, "disabled" as keyof T, !disabled)}>
                {disabled ? "○" : "●"}
              </button>
              <button className="icon danger" title="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
            <div className="grid2">
              {cols
                .filter((c) => !c.show || c.show(row))
                .map((c) => {
                  const v = row[c.key] as unknown as string | number | boolean | undefined;
                  if (c.type === "bool") return <Toggle key={c.key} label={c.label} checked={!!v} onChange={(x) => set(i, c.key, x)} />;
                  return (
                    <Field
                      key={c.key}
                      label={c.label}
                      value={v as string | number | undefined}
                      type={c.type === "number" ? "number" : "text"}
                      options={c.options}
                      suggestions={c.suggestions}
                      placeholder={c.placeholder}
                      wide={c.wide}
                      mono={c.mono}
                      invalid={!!c.validate && v !== undefined && v !== "" && !c.validate(String(v))}
                      onChange={(x) => set(i, c.key, c.type === "number" ? (x === "" ? undefined : Number(x)) : x || undefined)}
                    />
                  );
                })}
            </div>
          </div>
        );
      })}
      <button className="btn ghost add" onClick={() => onChange([...rows, newRow()])}>+ {addLabel}</button>
    </div>
  );
}

export function Section({ title, children, defaultOpen = false, count }: { title: string; children: ReactNode; defaultOpen?: boolean; count?: number }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {count !== undefined && <span className="pill">{count}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
