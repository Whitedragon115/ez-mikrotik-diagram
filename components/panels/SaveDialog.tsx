"use client";

import { useCallback, useEffect, useState } from "react";
import { useSim } from "@/lib/store";
import type { SavedSummary } from "@/lib/configs-api";
import type { PacketInput, RouterConfig } from "@/lib/sim/types";
import { Field } from "../ui/form";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

interface Me {
  configured: boolean;
  missing: string[];
  user: { id: string; name: string; avatar: string | null } | null;
}

const LOGIN_MSG: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: "Logged in with Discord." },
  cancelled: { ok: false, text: "Discord login was cancelled." },
  "invalid-state": { ok: false, text: "Login expired or was started in another tab. Please try again." },
  "token-failed": { ok: false, text: "Discord rejected the login. Check DISCORD_CLIENT_SECRET and that the redirect URL is registered." },
  "profile-failed": { ok: false, text: "Could not read your Discord profile." },
  "not-configured": { ok: false, text: "Discord login isn't configured on this server." },
  error: { ok: false, text: "Login failed. Please try again." },
};

export default function SaveDialog() {
  const open = useSim((s) => s.saveOpen);
  const setOpen = useSim((s) => s.setSaveOpen);
  const savedRef = useSim((s) => s.savedRef);
  const setSavedRef = useSim((s) => s.setSavedRef);
  const loadSaved = useSim((s) => s.loadSaved);
  const identity = useSim((s) => s.cfg.identity);

  const [list, setList] = useState<SavedSummary[] | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const loginResult = useSim((s) => s.loginResult);

  const refresh = useCallback(async () => {
    const who = await api<Me>("/api/auth/me").catch(() => ({ configured: false, missing: [], user: null }) as Me);
    setMe(who);
    if (!who.user) {
      setList([]);
      return;
    }
    try {
      setList(await api<SavedSummary[]>("/api/configs"));
    } catch (e) {
      setList([]);
      setMsg({ ok: false, text: `Could not reach the database: ${e instanceof Error ? e.message : e}` });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setMsg(loginResult ? LOGIN_MSG[loginResult] ?? LOGIN_MSG.error : null);
    useSim.setState({ loginResult: null });
    setName(savedRef?.name ?? identity);
    refresh();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refresh, setOpen, savedRef, identity]);

  if (!open) return null;

  const current = () => {
    const s = useSim.getState();
    return { config: s.cfg, packet: s.packet };
  };
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveNew = () =>
    run("new", async () => {
      const row = await api<SavedSummary>("/api/configs", { method: "POST", body: JSON.stringify({ name, description: desc || null, ...current() }) });
      setSavedRef({ id: row.id, name: row.name });
      setDesc("");
      return `Saved as “${row.name}”.`;
    });
  const overwrite = (id: string, label: string) =>
    run(`ow-${id}`, async () => {
      const row = await api<SavedSummary>(`/api/configs/${id}`, { method: "PUT", body: JSON.stringify(current()) });
      setSavedRef({ id: row.id, name: row.name });
      return `Updated “${label}”.`;
    });
  const load = (id: string) =>
    run(`ld-${id}`, async () => {
      const row = await api<SavedSummary & { config: RouterConfig; packet: PacketInput | null }>(`/api/configs/${id}`);
      loadSaved({ id: row.id, name: row.name }, row.config, row.packet);
      setOpen(false);
      return `Loaded “${row.name}”.`;
    });
  const remove = (id: string, label: string) =>
    run(`rm-${id}`, async () => {
      await api(`/api/configs/${id}`, { method: "DELETE" });
      if (savedRef?.id === id) setSavedRef(null);
      setConfirmDel(null);
      return `Deleted “${label}”.`;
    });
  const rename = (id: string, newName: string) =>
    run(`rn-${id}`, async () => {
      const row = await api<SavedSummary>(`/api/configs/${id}`, { method: "PUT", body: JSON.stringify({ name: newName }) });
      if (savedRef?.id === id) setSavedRef({ id, name: row.name });
      setRenaming(null);
      return `Renamed to “${row.name}”.`;
    });

  return (
    <div className="imp-backdrop no-canvas" onClick={() => setOpen(false)}>
      <div className="imp-dialog save-dialog" role="dialog" aria-modal="true" aria-label="Saved configurations" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="eyebrow" style={{ color: "var(--accent)" }}>Saved configs</div>
            <h2>Save &amp; load router setups</h2>
          </div>
          <button className="icon" onClick={() => setOpen(false)} title="Close">✕</button>
        </div>

        <div className="imp-body">
          {me === null ? (
            <p className="muted small">Checking login…</p>
          ) : !me.configured ? (
            <div className="login-card">
              <b>Saving isn&apos;t available yet</b>
              <p className="muted small">
                Saving requires Discord login, which this server hasn&apos;t been set up for. Fill in <code>{me.missing.join("</code>, <code>")}</code> in <code>.env</code> and restart. The README explains how to create a Discord application.
              </p>
              <p className="muted small">In the meantime, use <b>Export</b> to download your setup as JSON.</p>
            </div>
          ) : !me.user ? (
            <div className="login-card">
              <b>Log in to save your setups</b>
              <p className="muted small">Saved configs are stored on this server under your Discord account, and only you can see them. Your current, unsaved setup stays in your browser while you log in.</p>
              <a className="btn discord" href={`/api/auth/discord?returnTo=${encodeURIComponent("/?save=1")}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 0 13.6.3 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.7ZM8.5 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" /></svg>
                Log in with Discord
              </a>
            </div>
          ) : (
          <>
          <div className="whoami">
            {me.user.avatar ? <img src={me.user.avatar} alt="" width={28} height={28} /> : <span className="avatar-fallback">{me.user.name.slice(0, 1).toUpperCase()}</span>}
            <span>Logged in as <b>{me.user.name}</b></span>
            <span className="sp" />
            <button className="btn sm" onClick={async () => { await fetch("/api/auth/me", { method: "DELETE" }); setSavedRef(null); setMsg(null); refresh(); }}>Log out</button>
          </div>
          {savedRef && (
            <div className="save-current">
              <div>
                <span className="muted small">Currently editing</span>
                <b>{savedRef.name}</b>
              </div>
              <button className="btn primary" disabled={!!busy} onClick={() => overwrite(savedRef.id, savedRef.name)}>
                {busy === `ow-${savedRef.id}` ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}

          <div className="save-new">
            <h4 className="subhead">{savedRef ? "Save as a new copy" : "Save the current setup"}</h4>
            <div className="grid2">
              <Field label="Name" value={name} onChange={setName} placeholder="Home router" />
              <Field label="Description (optional)" value={desc} onChange={setDesc} placeholder="after adding the port forward" />
            </div>
            <div className="imp-actions">
              <span className="muted small">Includes the router config and the current test packet.</span>
              <span className="sp" />
              <button className="btn primary" disabled={!name.trim() || !!busy} onClick={saveNew}>{busy === "new" ? "Saving…" : "Save new"}</button>
            </div>
          </div>

          <h4 className="subhead">Saved in the database {list && <span className="pill">{list.length}</span>}</h4>
          {list === null ? (
            <p className="muted small">Loading…</p>
          ) : list.length === 0 ? (
            <p className="muted small">Nothing saved yet.</p>
          ) : (
            <ul className="saved-list">
              {list.map((c) => (
                <li key={c.id} className={savedRef?.id === c.id ? "on" : undefined}>
                  <div className="saved-main">
                    {renaming?.id === c.id ? (
                      <form className="saved-rename" onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) rename(c.id, renaming.name.trim()); }}>
                        <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} aria-label="New name" />
                        <button className="btn sm primary" type="submit">OK</button>
                        <button className="btn sm" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                      </form>
                    ) : (
                      <b>{c.name}{savedRef?.id === c.id && <span className="pill">current</span>}</b>
                    )}
                    <span className="muted small">
                      {c.identity} · updated {ago(c.updatedAt)}{c.description ? ` · ${c.description}` : ""}
                    </span>
                  </div>
                  {confirmDel === c.id ? (
                    <div className="saved-actions">
                      <span className="small">Delete permanently?</span>
                      <button className="btn sm danger" disabled={!!busy} onClick={() => remove(c.id, c.name)}>Delete</button>
                      <button className="btn sm" onClick={() => setConfirmDel(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="saved-actions">
                      <button className="btn sm primary" disabled={!!busy} onClick={() => load(c.id)}>{busy === `ld-${c.id}` ? "Loading…" : "Load"}</button>
                      <button className="btn sm" disabled={!!busy} onClick={() => overwrite(c.id, c.name)} title="Replace this saved config with the current setup">Overwrite</button>
                      <button className="btn sm" disabled={!!busy} onClick={() => setRenaming({ id: c.id, name: c.name })}>Rename</button>
                      <button className="btn sm danger" disabled={!!busy} onClick={() => setConfirmDel(c.id)}>Delete</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          </>
          )}
          {msg && <p className={msg.ok ? "note ok-note" : "note err"}>{msg.text}</p>}
        </div>
      </div>
    </div>
  );
}
