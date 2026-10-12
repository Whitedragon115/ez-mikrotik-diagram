import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultConfig, defaultPacket } from "./sim/defaults";
import { replyInput, simulate } from "./sim/engine";
import { TEMPLATES } from "./sim/templates";
import type { ConnEntry, PacketInput, RouterConfig, SimResult } from "./sim/types";

export type LeftTab = "packet" | "router";

/** user-chosen panel sizes (px) */
export interface Layout {
  leftW: number;
  rightW: number;
  traceH: number;
}
export const DEFAULT_LAYOUT: Layout = { leftW: 360, rightW: 420, traceH: 288 };

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SimState {
  cfg: RouterConfig;
  packet: PacketInput;
  conntrack: ConnEntry[];
  nextConnId: number;
  hits: Record<string, number>;
  result: SimResult | null;
  step: number;
  playing: boolean;
  selected: string | null;
  left: LeftTab | null;
  inspector: boolean;
  trace: boolean;
  templateId: string;
  explain: boolean;
  importOpen: boolean;
  saveOpen: boolean;
  exportOpen: boolean;
  /** result of a Discord login redirect (?login=…), shown once in the save dialog */
  loginResult: string | null;
  /** the saved config (database row) the current setup was loaded from / saved as */
  savedRef: { id: string; name: string } | null;
  layout: Layout;
  /** floating packet inspector; rect is null until it has been placed */
  pktWin: { open: boolean; rect: WinRect | null };

  setCfg: (fn: (draft: RouterConfig) => void) => void;
  setPacket: (p: Partial<PacketInput>) => void;
  run: (input?: PacketInput) => void;
  reply: () => void;
  clearConnections: () => void;
  resetCounters: () => void;
  setStep: (i: number) => void;
  setPlaying: (v: boolean) => void;
  select: (id: string | null) => void;
  setLeft: (t: LeftTab | null) => void;
  setInspector: (v: boolean) => void;
  setTrace: (v: boolean) => void;
  resetConfig: () => void;
  importConfig: (cfg: RouterConfig) => void;
  loadTemplate: (id: string) => void;
  setExplain: (v: boolean) => void;
  setImportOpen: (v: boolean) => void;
  setSaveOpen: (v: boolean) => void;
  setSavedRef: (r: { id: string; name: string } | null) => void;
  loadSaved: (r: { id: string; name: string }, cfg: RouterConfig, packet: PacketInput | null) => void;
  setLayout: (l: Partial<Layout>) => void;
  setPktWin: (w: Partial<SimState["pktWin"]>) => void;
}

export const useSim = create<SimState>()(
  persist(
    (set, get) => ({
      cfg: defaultConfig(),
      packet: defaultPacket(),
      conntrack: [],
      nextConnId: 1,
      hits: {},
      result: null,
      step: 0,
      playing: false,
      selected: null,
      left: "packet",
      inspector: true,
      trace: true,
      templateId: "home",
      explain: true,
      importOpen: false,
      saveOpen: false,
      exportOpen: false,
      loginResult: null,
      savedRef: null,
      layout: DEFAULT_LAYOUT,
      pktWin: { open: true, rect: null },

      setCfg: (fn) =>
        set((s) => {
          const cfg = structuredClone(s.cfg);
          fn(cfg);
          return { cfg };
        }),
      setPacket: (p) => set((s) => ({ packet: { ...s.packet, ...p } })),
      run: (input) => {
        const s = get();
        const pkt = input ?? s.packet;
        const res = simulate(s.cfg, pkt, { conntrack: s.conntrack, nextConnId: s.nextConnId });
        const hits = { ...s.hits };
        for (const [k, v] of Object.entries(res.hits)) hits[k] = (hits[k] ?? 0) + v;
        set({ result: res, conntrack: res.conntrack, nextConnId: res.nextConnId, hits, step: 0, playing: false, trace: true, explain: true, packet: pkt });
      },
      reply: () => {
        const s = get();
        if (!s.result) return;
        const r = replyInput(s.result, s.packet);
        if (r) s.run(r);
      },
      clearConnections: () => set({ conntrack: [] }),
      resetCounters: () => set({ hits: {} }),
      setStep: (i) => set({ step: i }),
      setPlaying: (v) => set({ playing: v }),
      select: (id) => set((s) => ({ selected: id, inspector: id ? true : s.inspector })),
      setLeft: (t) => set({ left: t }),
      setInspector: (v) => set({ inspector: v }),
      setTrace: (v) => set({ trace: v }),
      resetConfig: () => set({ cfg: defaultConfig(), packet: defaultPacket(), conntrack: [], hits: {}, result: null, nextConnId: 1, templateId: "home", savedRef: null }),
      importConfig: (cfg) => set({ cfg, conntrack: [], hits: {}, result: null, nextConnId: 1, templateId: "imported", savedRef: null, step: 0, playing: false }),
      loadTemplate: (id) => {
        const t = TEMPLATES.find((x) => x.id === id);
        if (!t) return;
        set({ cfg: t.build(), templateId: id, savedRef: null, conntrack: [], hits: {}, result: null, nextConnId: 1, step: 0, playing: false });
      },
      setExplain: (v) => set({ explain: v }),
      setImportOpen: (v) => set({ importOpen: v }),
      setSaveOpen: (v) => set({ saveOpen: v }),
      setSavedRef: (r) => set({ savedRef: r }),
      loadSaved: (r, cfg, packet) =>
        set((s) => ({ cfg, packet: packet ?? s.packet, savedRef: r, templateId: "saved", conntrack: [], hits: {}, result: null, nextConnId: 1, step: 0, playing: false })),
      setLayout: (l) => set((s) => ({ layout: { ...s.layout, ...l } })),
      setPktWin: (w) => set((s) => ({ pktWin: { ...s.pktWin, ...w } })),
    }),
    {
      name: "ros-packet-sim-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ cfg: s.cfg, packet: s.packet, conntrack: s.conntrack, nextConnId: s.nextConnId, hits: s.hits, templateId: s.templateId, savedRef: s.savedRef, layout: s.layout, pktWin: s.pktWin }),
      // older saved state has no layout/pktWin: fill in the defaults
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SimState>;
        return { ...current, ...p, layout: { ...DEFAULT_LAYOUT, ...p.layout }, pktWin: { ...current.pktWin, ...p.pktWin } };
      },
    },
  ),
);
