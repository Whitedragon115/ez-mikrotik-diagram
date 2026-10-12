// Parse the sample export and run a packet through it: `pnpm exec tsx scripts/import-check.ts`
import { readFileSync } from "node:fs";
import { importScript } from "../lib/sim/import";
import { simulate } from "../lib/sim/engine";
import { defaultPacket } from "../lib/sim/defaults";

const res = importScript(readFileSync(new URL("./fixtures/sample-export.rsc", import.meta.url), "utf8"));
console.log("identity:", res.cfg.identity);
console.log("stats:", res.stats.map((s) => `${s.label}=${s.count}`).join(", "));
console.log("interfaces:", res.cfg.interfaces.map((i) => `${i.name}:${i.type}${i.bridge ? "@" + i.bridge : ""}${i.parent ? "^" + i.parent : ""}`).join(" "));
console.log("lists:", JSON.stringify(res.cfg.interfaceLists));
console.log("routes:", JSON.stringify(res.cfg.routes));
console.log("ipsec:", JSON.stringify(res.cfg.ipsecPolicies));
console.log("filter:"); res.cfg.rules.filter.forEach((r, i) => console.log(`  ${i} ${r.disabled ? "X" : " "} ${r.chain} ${r.action} ${r.comment ?? ""}`));
console.log("nat:"); res.cfg.rules.nat.forEach((r, i) => console.log(`  ${i} ${r.disabled ? "X" : " "} ${r.chain} ${r.action} ${r.dstAddressType ?? ""} ${r.comment ?? ""}`));
console.log("mangle:"); res.cfg.rules.mangle.forEach((r, i) => console.log(`  ${i} ${r.disabled ? "X" : " "} ${r.chain} ${r.action} ${r.comment ?? ""}`));
console.log("warnings:\n  " + res.warnings.join("\n  "));
console.log("ignored:", res.ignored.join(", "));

// ether1 has no address in the export (DHCP client), so give it one for the run
res.cfg.addresses.push({ address: "203.0.113.10/24", interface: "ether1" });
const run = (name: string, p: Parameters<typeof simulate>[1]) => {
  const r = simulate(res.cfg, p, { conntrack: [], nextConnId: 1 });
  console.log(`${name}: ${r.verdict.kind} — ${r.verdict.text}`);
};
run("LAN → Internet", defaultPacket());
run("WAN → 8080 (dst-address-type=local)", { ...defaultPacket(), inInterface: "ether1", src: "198.51.100.7", dst: "203.0.113.10", dport: "8080" });
run("IoT → Internet (via-wg)", { ...defaultPacket(), src: "192.168.20.5", encap: "vlan", vlanId: 20 });
