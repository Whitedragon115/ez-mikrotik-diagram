// Quick sanity run of the simulator: `npx tsx scripts/sim-check.ts`
import { defaultConfig, PRESETS } from "../lib/sim/defaults";
import { replyInput, simulate } from "../lib/sim/engine";
import { edgeKey, edgeMap } from "../lib/flow";
import type { ConnEntry } from "../lib/sim/types";

const cfg = defaultConfig();
let state = { conntrack: [] as ConnEntry[], nextConnId: 1 };
let failures = 0;

function check(name: string, input: Parameters<typeof simulate>[1], expect?: string) {
  const res = simulate(cfg, input, state);
  state = { conntrack: res.conntrack, nextConnId: res.nextConnId };
  const path = res.steps.map((s) => s.node);
  const missing = path.slice(1).map((n, i) => [path[i], n]).filter(([a, b]) => !edgeMap[edgeKey(a, b)] && !(a === "r_decrypt") && !(a === "decapsulation" && b === "in_log" ));
  const ok = (!expect || res.verdict.kind === expect) && missing.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(24)} ${res.verdict.kind.padEnd(10)} ${res.verdict.text}`);
  if (missing.length) console.log("   missing edges:", missing.map((m) => m.join(">")).join(", "));
  return res;
}

const expected: Record<string, string> = {
  "LAN → Internet": "forwarded",
  "Port forward": "forwarded",
  "Blocked from WAN": "dropped",
  "LAN → LAN (bridged)": "forwarded",
  "Ping the router": "delivered",
  "Router → DNS": "forwarded",
  "LAN → branch (GRE)": "forwarded",
  "Branch → LAN (GRE in)": "forwarded",
  "Guest VLAN 10": "forwarded",
  "Blocked address list": "dropped",
};

for (const p of PRESETS) {
  const res = check(p.name, p.p, expected[p.name]);
  const reply = replyInput(res, p.p);
  if (reply && res.verdict.kind !== "dropped") {
    const r = check(`  ↳ reply`, reply);
    const last = r.steps.at(-1)!.pkt;
    console.log(`     reply ends ${last.src}:${last.sport ?? ""} → ${last.dst}:${last.dport ?? ""} [${r.steps.find((s) => s.pkt.connState)?.pkt.connState}]`);
  }
}
console.log(`\nconnections: ${state.conntrack.length}`);
for (const c of state.conntrack) console.log(`  #${c.id} ${c.proto} ${c.orig.src}:${c.orig.sport} → ${c.orig.dst}:${c.orig.dport}  reply-dst ${c.reply.dst}:${c.reply.dport} ${c.seenReply ? "seen-reply" : ""}`);
process.exit(failures ? 1 : 0);
