"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSim } from "@/lib/store";
import { buildConfig, importScript, type ImportResult, type Sections } from "@/lib/sim/import";
import type { RouterConfig } from "@/lib/sim/types";
import { Field, Toggle } from "../ui/form";

type Tab = "paste" | "file" | "connect";

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="imp-cmd">
      <pre className="mono">{children}</pre>
      <button
        className="btn sm"
        onClick={async () => {
          await navigator.clipboard?.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="imp-steps">{children}</ol>;
}

function Summary({ res, onApply, onBack }: { res: ImportResult; onApply: () => void; onBack: () => void }) {
  const nonzero = res.stats.filter((s) => s.count > 0);
  return (
    <div className="imp-summary">
      <div className="imp-sum-head">
        <div>
          <div className="eyebrow">Ready to import · {res.source}</div>
          <h3>{res.cfg.identity}</h3>
        </div>
      </div>
      <div className="imp-stats">
        {nonzero.map((s) => (
          <div key={s.label} className="imp-stat">
            <b>{s.count}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      {res.warnings.length > 0 && (
        <details className="imp-warn" open={res.warnings.length <= 6}>
          <summary>{res.warnings.length} note{res.warnings.length > 1 ? "s" : ""}: parts that are approximated or not simulated</summary>
          <ul>{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <p className="muted small">Rules that use a matcher the simulator doesn&apos;t support are imported <b>disabled</b>, so they can&apos;t match more traffic than they should. Their comments say why.</p>
        </details>
      )}
      {res.ignored.length > 0 && (
        <p className="muted small">Not part of the packet-flow simulation (skipped): {res.ignored.join(", ")}.</p>
      )}
      <p className="muted small">
        Not included in an export: the bridge host table (MAC learning), so traffic to unknown hosts is flooded. Addresses that DHCP gives the router (e.g. on the WAN) are also missing; add them under Router → IP addresses.
      </p>
      <div className="imp-actions">
        <button className="btn" onClick={onBack}>Back</button>
        <span className="sp" />
        <button className="btn primary big" onClick={onApply}>Replace current config</button>
      </div>
    </div>
  );
}

export default function ImportDialog() {
  const open = useSim((s) => s.importOpen);
  const setOpen = useSim((s) => s.setImportOpen);
  const importConfig = useSim((s) => s.importConfig);
  const [tab, setTab] = useState<Tab>("paste");
  const [text, setText] = useState("");
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [conn, setConn] = useState({ host: "192.168.88.1", port: "", https: false, insecure: true, username: "sim-import", password: "" });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setRes(null);
    setErr("");
  };
  const parse = (src: string, label: string) => {
    setErr("");
    const r = importScript(src, label);
    if (r.stats.every((s) => s.count === 0)) {
      setErr("Nothing recognisable was found. Paste the full output of /export, starting with lines like “/interface bridge”.");
      return;
    }
    setRes(r);
  };
  const onFile = async (f: File) => {
    setErr("");
    const t = await f.text();
    if (f.name.endsWith(".json")) {
      try {
        const cfg = JSON.parse(t) as RouterConfig;
        if (!Array.isArray(cfg.interfaces) || !cfg.rules) throw new Error("not a simulator JSON file");
        importConfig(cfg);
        close();
      } catch (e) {
        setErr(`Could not read ${f.name}: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }
    parse(t, f.name);
  };
  const connect = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/router-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...conn, port: Number(conn.port) || undefined }),
      });
      const data = (await r.json()) as { sections?: Sections; errors?: string[]; error?: string };
      if (!r.ok || !data.sections) throw new Error(data.error ?? `HTTP ${r.status}`);
      setRes(buildConfig(data.sections, (data.errors ?? []).map((e) => `Could not read ${e}`), `${conn.host} (REST API)`));
      setConn((c) => ({ ...c, password: "" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="imp-backdrop no-canvas" onClick={close}>
      <div className="imp-dialog" role="dialog" aria-modal="true" aria-label="Import router configuration" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="eyebrow" style={{ color: "var(--accent)" }}>Import</div>
            <h2>Bring in your MikroTik&apos;s configuration</h2>
          </div>
          <button className="icon" onClick={close} title="Close">✕</button>
        </div>

        {res ? (
          <div className="imp-body">
            <Summary res={res} onBack={() => setRes(null)} onApply={() => { importConfig(res.cfg); close(); }} />
          </div>
        ) : (
          <>
            <div className="imp-tabs">
              {([
                ["paste", "Paste /export", "Quickest: run one command and paste"],
                ["file", "Upload .rsc file", "Export to a file on the router"],
                ["connect", "Connect read-only", "Let this app read it over the REST API"],
              ] as [Tab, string, string][]).map(([id, title, sub]) => (
                <button key={id} className={tab === id ? "imp-tab on" : "imp-tab"} onClick={() => { setTab(id); setErr(""); }}>
                  <b>{title}</b>
                  <span>{sub}</span>
                </button>
              ))}
            </div>

            <div className="imp-body">
              {tab === "paste" && (
                <>
                  <Steps>
                    <li>Open a terminal on the router: <b>WinBox → New Terminal</b>, <b>WebFig → Terminal</b>, or SSH.</li>
                    <li>
                      Run the export command. RouterOS 7 leaves out passwords and keys by default:
                      <Cmd>/export</Cmd>
                      <span className="muted small">On RouterOS 6, use <code>/export hide-sensitive</code> so secrets aren&apos;t included.</span>
                    </li>
                    <li>Select all the output, copy it, and paste it below.</li>
                  </Steps>
                  <textarea
                    className="mono imp-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={"# 2026-10-12 by RouterOS 7.x\n/interface bridge\nadd name=bridge\n/ip address\nadd address=192.168.88.1/24 interface=bridge\n..."}
                    spellCheck={false}
                  />
                  <div className="imp-actions">
                    <span className="muted small">Everything is parsed in your browser. Nothing is uploaded.</span>
                    <span className="sp" />
                    <button className="btn primary" disabled={!text.trim()} onClick={() => parse(text, "pasted /export")}>Read configuration</button>
                  </div>
                </>
              )}

              {tab === "file" && (
                <>
                  <Steps>
                    <li>
                      In the router terminal, export to a file:
                      <Cmd>/export file=sim-config</Cmd>
                    </li>
                    <li>
                      Download <code>sim-config.rsc</code>. In <b>WinBox → Files</b>, drag it to your desktop (or right-click → Download). In <b>WebFig → Files</b>, click Download. You can also use SFTP/SCP.
                    </li>
                    <li>Drop the file below.</li>
                  </Steps>
                  <div
                    className={drag ? "imp-drop on" : "imp-drop"}
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
                    onClick={() => fileRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
                  >
                    <b>Drop a .rsc export here</b>
                    <span className="muted small">or click to choose a file · .json simulator backups work too</span>
                  </div>
                  <input ref={fileRef} type="file" accept=".rsc,.txt,.json,text/plain,application/json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                </>
              )}

              {tab === "connect" && (
                <>
                  <Steps>
                    <li>
                      Create a group that can only <b>read</b> (no write, no access to sensitive data), plus a user for this app. Limit it to your PC&apos;s address:
                      <Cmd>{`/user group add name=sim-readonly policy=read,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!romon
/user add name=sim-import group=sim-readonly address=192.168.88.0/24 password="use-a-strong-password"`}</Cmd>
                      <span className="muted small">Older RouterOS 7 releases don&apos;t have the <code>rest-api</code> policy. If the first command fails, remove <code>rest-api,</code> and change <code>!web</code> to <code>web</code>. Change <code>address=</code> to the network your PC is on.</span>
                    </li>
                    <li>
                      Make sure the router&apos;s web service is reachable (RouterOS 7 serves the REST API on it). HTTPS (<code>www-ssl</code>) needs a certificate. Plain HTTP (<code>www</code>) is fine on a trusted LAN:
                      <Cmd>{`/ip service set www-ssl disabled=no
/ip service set www disabled=no address=192.168.88.0/24`}</Cmd>
                    </li>
                    <li>Enter the details below. When you&apos;re done, remove the account:</li>
                  </Steps>
                  <Cmd>/user remove sim-import</Cmd>
                  <div className="grid2 imp-form">
                    <Field label="Router address" value={conn.host} mono onChange={(v) => setConn({ ...conn, host: v.trim() })} />
                    <Field label="Port" value={conn.port} mono placeholder={conn.https ? "443" : "80"} onChange={(v) => setConn({ ...conn, port: v.replace(/\D/g, "") })} />
                    <Field label="Username" value={conn.username} mono onChange={(v) => setConn({ ...conn, username: v })} />
                    <label className="field">
                      <span>Password</span>
                      <input type="password" value={conn.password} autoComplete="off" onChange={(e) => setConn({ ...conn, password: e.target.value })} />
                    </label>
                    <Toggle label="Use HTTPS (www-ssl)" checked={conn.https} onChange={(v) => setConn({ ...conn, https: v })} />
                    {conn.https && <Toggle label="Accept self-signed certificate" checked={conn.insecure} onChange={(v) => setConn({ ...conn, insecure: v })} />}
                  </div>
                  <p className="note small">
                    The browser can&apos;t reach the router directly, so this app&apos;s own server makes the connection. When you run it locally with <code>pnpm dev</code>, that server is your PC. The password is used for this one request and is never saved. Use a read-only account, not your admin account.
                  </p>
                  <div className="imp-actions">
                    <span className="sp" />
                    <button className="btn primary" disabled={busy || !conn.host || !conn.username} onClick={connect}>{busy ? "Connecting…" : "Connect & read config"}</button>
                  </div>
                </>
              )}
              {err && <p className="note err">{err}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
