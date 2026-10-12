// Site-wide SEO text and URL. APP_URL is the public address (set it at build time for Docker).
export const SITE_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");

export const SITE_NAME = "MikroTik Packet Flow Simulator";
export const SITE_TITLE = "MikroTik Online Simulator & Firewall Debugger — Free, No Login";
export const SITE_SHORT = "Free online RouterOS packet flow simulator & firewall rule debugger";
export const SITE_DESCRIPTION =
  "Free online MikroTik RouterOS simulator and firewall debugger. Send a test packet and follow it step by step through the RouterOS packet flow (bridge, raw, connection tracking, mangle, NAT, filter, routing, IPsec and queues) to see exactly which rule made each decision. Import your /export, no install, no login required.";

export const SITE_KEYWORDS = [
  "MikroTik simulator",
  "MikroTik online simulator",
  "RouterOS simulator",
  "MikroTik firewall debugger",
  "MikroTik packet flow",
  "RouterOS packet flow diagram",
  "MikroTik firewall rules tester",
  "MikroTik NAT tester",
  "dst-nat port forward test",
  "MikroTik mangle",
  "RouterOS v7",
  "WinBox",
  "MikroTik config checker",
  "free",
  "no login",
];

export const SITE_FEATURES = [
  "Step-by-step packet trace through the full RouterOS packet flow",
  "Shows which firewall, NAT, mangle or raw rule matched, and why other rules didn't",
  "Connection tracking with reply packets and automatic NAT reversal",
  "Bridging, VLANs, GRE/IPIP/EoIP tunnels, IPsec and policy routing",
  "Import your MikroTik config: paste /export, upload .rsc or connect read-only",
  "Ready-made setups: port forwarding, hairpin NAT, dual WAN, guest VLAN, site-to-site IPsec, QoS",
  "Runs in the browser: free, no install, no login required to simulate",
];
