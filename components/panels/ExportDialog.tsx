"use client";

import { useEffect, useMemo, useState } from "react";
import { useSim } from "@/lib/store";
import { toScript } from "@/lib/sim/nodes";
import { Toggle } from "../ui/form";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "router";

export default function ExportDialog() {
  const open = useSim((s) => s.exportOpen);
  const cfg = useSim((s) => s.cfg);
  const [tab, setTab] = useState<"rsc" | "json">("rsc");
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = () => useSim.setState({ exportOpen: false });

  useEffect(() => {
    if (!open) return;
    setAck(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const script = useMemo(() => (open ? toScript(cfg) : ""), [open, cfg]);
  const json = useMemo(() => (open ? JSON.stringify(cfg, null, 2) : ""), [open, cfg]);
  if (!open) return null;

  const text = tab === "rsc" ? script : json;
  const locked = tab === "rsc" && !ack;
  const base = safeName(cfg.identity);

  return (
    <div className="imp-backdrop no-canvas" onClick={close}>
      <div className="imp-dialog" role="dialog" aria-modal="true" aria-label="Export configuration" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="eyebrow" style={{ color: "var(--accent)" }}>Export</div>
            <h2>Export this setup</h2>
          </div>
          <button className="icon" onClick={close} title="Close">✕</button>
        </div>

        <div className="imp-body">
          <div className="danger-box" role="alert">
            <b>⚠ Don&apos;t paste this into your MikroTik</b>
            <p>
              The export is meant for this website only: load it back here with <b>Import</b>. It uses RouterOS-compatible syntax, but it only contains what the simulator models. DHCP, DNS, users, services, wireless and MAC settings are missing, and imported setups can contain placeholder addresses.
              Running it on a live router can <b>break connectivity or lock you out</b>.
            </p>
          </div>

          <div className="exp-tabs">
            <button className={tab === "rsc" ? "imp-tab on" : "imp-tab"} onClick={() => setTab("rsc")}>
              <b>RouterOS script (.rsc)</b>
              <span>Readable, RouterOS-style. Re-import with Paste /export.</span>
            </button>
            <button className={tab === "json" ? "imp-tab on" : "imp-tab"} onClick={() => setTab("json")}>
              <b>Simulator backup (.json)</b>
              <span>Exact copy of everything, for Import → Upload.</span>
            </button>
          </div>

          <textarea className="mono imp-text exp-text" readOnly value={text} spellCheck={false} aria-label="Export preview" />

          {tab === "rsc" && (
            <Toggle
              label="I understand: this is for re-importing into the simulator, not for running on my router"
              checked={ack}
              onChange={setAck}
            />
          )}
          <div className="imp-actions">
            <span className="muted small">{text.split("\n").length} lines</span>
            <span className="sp" />
            <button
              className="btn"
              disabled={locked}
              onClick={async () => {
                await navigator.clipboard?.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="btn primary"
              disabled={locked}
              onClick={() => (tab === "rsc" ? download(`${base}.sim.rsc`, script, "text/plain") : download(`${base}.sim.json`, json, "application/json"))}
            >
              Download {tab === "rsc" ? ".rsc" : ".json"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
