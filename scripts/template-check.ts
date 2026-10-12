// Run every template's test packets: `npx tsx scripts/template-check.ts`
import { TEMPLATES } from "../lib/sim/templates";
import { simulate } from "../lib/sim/engine";
import { decisionTag } from "../lib/sim/explain";
import { edgeKey, edgeMap } from "../lib/flow";

let bad = 0;
for (const t of TEMPLATES) {
  const cfg = t.build();
  console.log(`\n# ${t.name}`);
  for (const p of t.packets) {
    const res = simulate(cfg, p.p, { conntrack: [], nextConnId: 1 });
    const path = res.steps.map((s) => s.node);
    const missing = path.slice(1).filter((n, i) => !edgeMap[edgeKey(path[i], n)] && path[i] !== "r_decrypt" && !(path[i] === "decapsulation" && n === "in_log"));
    const tags = res.steps.map(decisionTag).filter(Boolean);
    const route = res.steps.flatMap((s) => s.notes).find((n) => n.startsWith("Matched route") || n.includes("table"));
    if (missing.length || res.verdict.kind === "error") bad++;
    console.log(`  ${res.verdict.kind.padEnd(9)} ${p.name.padEnd(26)} ${res.verdict.text}`);
    console.log(`            expect: ${p.desc} | rules: ${tags.join(", ") || "—"}${route ? " | " + route : ""}`);
  }
}
process.exit(bad ? 1 : 0);
