// Turns a trace step into a human explanation: what was decided and which rule caused it.
import { plain, byId } from "../flow";
import { formatRule, TABLE_INFO } from "./rules";
import type { RouterConfig, TraceStep, Table, PktSnap } from "./types";

export interface DecidingRule {
  table: Table;
  chain: string;
  index: number;
  ruleId: string;
  action: string;
  result: string;
  text: string;
  comment?: string;
  final: boolean;
}

export interface Decision {
  title: string;
  tone: "yes" | "no" | "drop" | "done" | "change" | "info";
  headline: string;
  rules: DecidingRule[];
  facts: string[];
  changes: string[];
}

const FIELD_LABEL: Partial<Record<keyof PktSnap, string>> = {
  src: "src", sport: "src-port", dst: "dst", dport: "dst-port", ttl: "ttl", packetMark: "packet-mark",
  connMark: "connection-mark", routingMark: "routing-mark", outIface: "out-interface", connState: "connection-state", vlan: "vlan",
};

export function explain(step: TraceStep, prev: TraceStep | undefined, cfg: RouterConfig): Decision {
  const title = plain(byId[step.node]?.t ?? step.node);
  const rules: DecidingRule[] = [];
  const facts: string[] = [];
  for (const s of step.stages ?? []) {
    const matched = s.evals.filter((e) => e.matched);
    for (const [i, e] of matched.entries()) {
      const r = s.table && cfg.rules[s.table].find((x) => x.id === e.ruleId);
      rules.push({
        table: s.table!,
        chain: s.chain!,
        index: e.index,
        ruleId: e.ruleId,
        action: r ? r.action : "?",
        result: e.action ?? "",
        text: r ? formatRule({ ...r, chain: "", action: "", comment: undefined, disabled: false }) || "(matches every packet)" : "(rule was deleted)",
        comment: r?.comment,
        final: i === matched.length - 1,
      });
    }
    if (!matched.length && s.kind !== "skip")
      facts.push(s.evals.length ? `${s.name}: ${s.evals.length} rule${s.evals.length > 1 ? "s" : ""} checked, none matched → accept` : `${s.name}: ${s.result}`);
  }
  const changed = step.stages?.find((s) => s.kind === "change" && !s.evals.some((e) => e.matched));

  const changes: string[] = [];
  if (prev) {
    for (const [k, label] of Object.entries(FIELD_LABEL) as [keyof PktSnap, string][]) {
      if (prev.pkt[k] !== step.pkt[k] && step.pkt[k] !== undefined && !(k === "outIface" && prev.pkt[k] === undefined) && !(k === "connState" && prev.pkt[k] === undefined))
        changes.push(`${label}: ${prev.pkt[k] ?? "—"} → ${step.pkt[k]}`);
    }
  }

  const tone: Decision["tone"] =
    step.status === "drop" ? "drop" : step.status === "done" ? "done" : step.outcome ?? (changes.length || rules.some((r) => r.final) ? "change" : "info");

  let headline = step.notes[0] ?? "";
  if (step.status === "drop") {
    const drop = step.stages?.find((s) => s.kind === "drop");
    headline = drop ? `Dropped by ${drop.name}: ${drop.result}` : step.notes[step.notes.length - 1] ?? "Dropped";
  } else if (step.outcome) headline = `${step.outcome === "yes" ? "Yes" : "No"}: ${step.notes[0] ?? ""}`;
  else if (!headline && rules.length) {
    const fin = rules.filter((r) => r.final);
    headline = fin.map((r) => `${TABLE_INFO[r.table].label} ${r.chain} rule #${r.index}: ${r.result || r.action}`).join(" · ");
  } else if (!headline && changed) headline = `${changed.name}: ${changed.result}`;
  else if (!headline) headline = step.stages?.length ? "No rule matched; the packet passes unchanged." : facts[0] ?? "Passed";

  return { title, tone, headline, rules, facts: step.notes.slice(1).concat(facts), changes };
}

/** Short tag for the step list, e.g. "filter #7 drop". */
export function decisionTag(step: TraceStep): string | null {
  for (const s of [...(step.stages ?? [])].reverse()) {
    const m = [...s.evals].reverse().find((e) => e.matched);
    if (m && s.table) return `${TABLE_INFO[s.table].label.toLowerCase()} #${m.index} ${m.action?.split(/[: ]/)[0] ?? ""}`.trim();
  }
  return null;
}
