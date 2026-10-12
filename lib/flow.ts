// RouterOS packet-flow model: diagram geometry, chain stages and traced scenarios.

export const VBW = 1820;
export const VBH = 905;

export type Shape = "box" | "decision" | "para" | "hex" | "pill" | "portal" | "chain";
export type LayerKey = "if" | "sw" | "l2" | "mpls" | "l3" | "loc";
export type ChainKey = "prerouting" | "input" | "forward" | "output" | "postrouting";
export type TableKey = "raw" | "ct" | "mangle" | "nat" | "filter" | "queue" | "hs" | "acct" | "ttl" | "cond";

/** [name, table, menu path, description] */
export type Stage = [string, TableKey, string, string];
export type Point = [number, number];
/** [from, to, points, decision label] */
export type Edge = [string, string, Point[], ("yes" | "no")?];

export interface FlowNode {
  id: string;
  s: Shape;
  x: number;
  y: number;
  w: number;
  h: number;
  L: LayerKey;
  t: string;
  sub?: string;
  /** color variable override */
  c?: string;
  d: string;
  m?: string;
  chain?: ChainKey;
}

export const CHAINS: Record<ChainKey, Stage[]> = {
  prerouting: [
    ["Hotspot-in", "hs", "/ip hotspot", "Unauthenticated HotSpot clients are captured here (only when HotSpot is enabled)."],
    ["Raw prerouting", "raw", "/ip firewall raw chain=prerouting", "Stateless, cheap filtering before conntrack: drop floods early, or mark traffic as notrack."],
    ["Connection tracking", "ct", "/ip firewall connection tracking", "Packet is matched to a connection and gets its state: new, established, related or invalid."],
    ["Mangle prerouting", "mangle", "/ip firewall mangle chain=prerouting", "Mark connections, packets or routing; change DSCP, TTL or MSS before the routing decision."],
    ["DST-NAT", "nat", "/ip firewall nat chain=dstnat", "Destination NAT: port forwarding, redirects. Changes where the packet will be routed."],
  ],
  input: [
    ["Mangle input", "mangle", "/ip firewall mangle chain=input", "Marking for traffic addressed to the router itself."],
    ["Filter input", "filter", "/ip firewall filter chain=input", "Protects the router: allow management/services and drop the rest."],
    ["HTB global (queue tree)", "queue", "/queue tree parent=global", "Global queue tree shaping for traffic going to the router."],
    ["Simple queues", "queue", "/queue simple", "Simple queues for traffic going to the router."],
  ],
  forward: [
    ["Bridge decision", "cond", "", "Only for bridged traffic with use-ip-firewall=yes."],
    ["TTL = TTL − 1", "ttl", "", "Routed packets have their TTL decremented. A packet that reaches 0 is dropped."],
    ["Mangle forward", "mangle", "/ip firewall mangle chain=forward", "Marking for traffic passing through the router (e.g. MSS clamping)."],
    ["Filter forward", "filter", "/ip firewall filter chain=forward", "Protects clients and networks behind the router: the main through-traffic firewall."],
    ["Accounting", "acct", "/ip accounting", "IP accounting counters (RouterOS v6)."],
  ],
  output: [
    ["Bridge decision", "cond", "", "Only when the output goes out through a bridge."],
    ["Raw output", "raw", "/ip firewall raw chain=output", "Stateless filtering or notrack for router-generated traffic."],
    ["Connection tracking", "ct", "/ip firewall connection tracking", "Router-generated packets are tracked too."],
    ["Mangle output", "mangle", "/ip firewall mangle chain=output", "Mark router-generated traffic, e.g. to policy-route it."],
    ["Filter output", "filter", "/ip firewall filter chain=output", "Control what the router itself may send."],
    ["Routing adjustment", "cond", "", "If mangle changed the routing mark or the packet, it is routed again."],
  ],
  postrouting: [
    ["Mangle postrouting", "mangle", "/ip firewall mangle chain=postrouting", "Last chance to mark or change packets, e.g. set DSCP or priority for queues."],
    ["SRC-NAT", "nat", "/ip firewall nat chain=srcnat", "Source NAT: masquerade or src-nat to the public address."],
    ["Hotspot-out", "hs", "/ip hotspot", "HotSpot outbound processing."],
    ["HTB global (queue tree)", "queue", "/queue tree parent=global", "Global queue tree shaping."],
    ["Simple queues", "queue", "/queue simple", "Simple queues (per-target bandwidth limits)."],
  ],
};

export const TABLES: Record<TableKey, [string, string]> = {
  raw: ["Raw", "--t-raw"],
  ct: ["Conn. tracking", "--t-ct"],
  mangle: ["Mangle", "--t-mangle"],
  nat: ["NAT", "--t-nat"],
  filter: ["Filter", "--t-filter"],
  queue: ["Queues", "--t-queue"],
  hs: ["HotSpot", "--t-hs"],
  acct: ["Accounting", "--t-acct"],
  ttl: ["TTL", "--t-acct"],
  cond: ["Conditional", "--t-cond"],
};

export const LAYERS: Record<LayerKey, { name: string; c: string; f?: string }> = {
  if: { name: "Interface", c: "--in" },
  sw: { name: "Dispatch", c: "--sw" },
  l2: { name: "Bridging", c: "--l2", f: "--l2-fill" },
  mpls: { name: "MPLS", c: "--mpls", f: "--mpls-fill" },
  l3: { name: "Routing", c: "--l3", f: "--l3-fill" },
  loc: { name: "Router", c: "--loc", f: "--loc-fill" },
};

/** Dashed background regions: [x, y, w, h, label, layer] */
export const LAYER_BOXES: [number, number, number, number, string, LayerKey][] = [
  [190, 135, 510, 605, "L2 · BRIDGING", "l2"],
  [745, 135, 335, 605, "MPLS", "mpls"],
  [1140, 135, 460, 605, "L3 · ROUTING", "l3"],
  [1636, 135, 128, 385, "ROUTER", "loc"],
];

export const chainDesc = (c: ChainKey) =>
  "Firewall chain. Expands to " + CHAINS[c].map((s) => s[0]).join(" → ") + ".";

const IPFW =
  "Bridge setting use-ip-firewall. When it is on, bridged IP traffic also passes through the IP firewall chains (Prerouting, Forward, Postrouting).";

export const NODES: FlowNode[] = [
  { id: "in_phys", s: "pill", x: 95, y: 95, w: 120, h: 38, L: "if", c: "--in", t: "Physical\nin-interface", d: "A frame arrives on a physical port (Ethernet, SFP, wireless…). Most packets start here." },
  { id: "in_log", s: "pill", x: 250, y: 30, w: 150, h: 30, L: "if", c: "--logic", t: "Logical in-interface", d: "After decapsulation, the inner packet comes back in as if it arrived on the logical interface (VLAN, EoIP, GRE, IPIP, VPLS…). It can then be bridged, routed and filtered again." },
  { id: "q_inbr", s: "decision", x: 250, y: 95, w: 130, h: 54, L: "sw", t: "In-iface\nbridge port?", d: "Is the receiving interface a bridge port? Yes: L2 bridge processing comes first. No: bridging is skipped.", m: "/interface bridge port" },
  { id: "q_mpls_in", s: "decision", x: 720, y: 95, w: 110, h: 54, L: "sw", t: "MPLS\ntraffic?", d: "Does the frame carry an MPLS label? Yes: MPLS processing. No: go on to the IP check." },
  { id: "q_ip_in", s: "decision", x: 1115, y: 95, w: 110, h: 54, L: "sw", t: "IPv4 /\nIPv6?", d: "Is it an IP packet? Yes: the routing layer. No (for example a VLAN-tagged frame on a non-bridge port): go to the decapsulation check." },
  { id: "q_decap", s: "decision", x: 1485, y: 95, w: 120, h: 54, L: "sw", t: "Decapsulate?", d: "Does this router terminate the tunnel or VLAN (EoIP, GRE, IPIP, VLAN, VXLAN…)? Yes: strip the outer header. No: deliver to the router's own processes." },
  { id: "decapsulation", s: "box", x: 1485, y: 30, w: 150, h: 30, L: "sw", t: "Decapsulation", sub: "VLAN · tunnel · VPLS · TE", d: "The outer header is removed. The inner packet or frame comes back in on the logical in-interface." },

  { id: "br_dstnat", s: "box", x: 250, y: 240, w: 100, h: 36, L: "l2", t: "Bridge\nDST-NAT", d: "Bridge NAT, dstnat chain. Can rewrite the destination MAC or apply L2 actions before the bridging decision.", m: "/interface bridge nat chain=dstnat" },
  { id: "br_ipfw1", s: "decision", x: 380, y: 240, w: 110, h: 50, L: "sw", t: "use-ip-\nfirewall?", d: IPFW, m: "/interface bridge settings use-ip-firewall" },
  { id: "br_pre", s: "chain", chain: "prerouting", x: 380, y: 170, w: 110, h: 36, L: "l2", t: "PREROUTING", d: chainDesc("prerouting") },
  { id: "br_decision", s: "para", x: 530, y: 240, w: 112, h: 40, L: "l2", t: "Bridging\ndecision", d: "The bridge looks up the destination MAC in its host table. Frames for the bridge itself go to Bridge input. All others are forwarded, or flooded when the MAC is unknown.", m: "/interface bridge host" },
  { id: "br_input", s: "box", x: 650, y: 240, w: 80, h: 36, L: "l2", t: "Bridge\ninput", d: "Bridge filter, input chain. Frames addressed to the bridge interface itself, which go on to be routed or reach the router.", m: "/interface bridge filter chain=input" },
  { id: "br_forward", s: "box", x: 530, y: 350, w: 110, h: 36, L: "l2", t: "Bridge\nforward", d: "Bridge filter, forward chain. Frames switched between bridge ports. Broadcast or unknown-unicast frames can be flooded to several ports.", m: "/interface bridge filter chain=forward" },
  { id: "br_ipfw2", s: "decision", x: 530, y: 440, w: 100, h: 50, L: "sw", t: "use-ip-\nfirewall?", d: IPFW, m: "/interface bridge settings use-ip-firewall" },
  { id: "br_fwd", s: "chain", chain: "forward", x: 650, y: 440, w: 84, h: 36, L: "l2", t: "FORWARD", d: chainDesc("forward") },
  { id: "br_srcnat", s: "box", x: 530, y: 560, w: 110, h: 36, L: "l2", t: "Bridge\nSRC-NAT", d: "Bridge NAT, srcnat chain. The last bridge-level hook before the frame leaves a bridge port.", m: "/interface bridge nat chain=srcnat" },
  { id: "br_ipfw3", s: "decision", x: 380, y: 560, w: 110, h: 50, L: "sw", t: "use-ip-\nfirewall?", d: IPFW, m: "/interface bridge settings use-ip-firewall" },
  { id: "br_post", s: "chain", chain: "postrouting", x: 380, y: 650, w: 110, h: 36, L: "l2", t: "POSTROUTING", d: chainDesc("postrouting") },
  { id: "br_output", s: "box", x: 510, y: 660, w: 100, h: 36, L: "l2", t: "Bridge\noutput", d: "Bridge filter, output chain. Frames that the router generated or routed into the bridge, on their way out of a bridge port.", m: "/interface bridge filter chain=output" },
  { id: "br_decision_out", s: "para", x: 640, y: 660, w: 100, h: 40, L: "l2", t: "Bridging\ndecision", d: "The out-interface is a bridge, so the bridge picks the actual port from its MAC host table (or floods)." },

  { id: "dec_in", s: "para", x: 800, y: 220, w: 100, h: 40, L: "mpls", t: "MPLS\ndecision", d: "Looks up the incoming label in the MPLS forwarding table. The label is either swapped (switched) or popped (this router is the egress).", m: "/mpls forwarding-table" },
  { id: "pop", s: "box", x: 930, y: 220, w: 100, h: 40, L: "mpls", t: "Pop label", sub: "MPLS input", d: "The label is removed and the payload goes on as IP, or as VPLS/TE tunnel traffic." },
  { id: "vpls", s: "decision", x: 930, y: 300, w: 100, h: 50, L: "sw", t: "VPLS or\nTE tunnel?", d: "Was it a VPLS pseudowire or a TE tunnel? Yes: the payload is decapsulated onto the logical VPLS/TE interface. No: the inner IP packet goes to the IP check." },
  { id: "portal_decap", s: "portal", x: 930, y: 366, w: 120, h: 22, L: "mpls", t: "↗ to Decapsulation", d: "Continues at the Decapsulation step, top right." },
  { id: "switch", s: "box", x: 800, y: 420, w: 100, h: 40, L: "mpls", t: "Switch label", sub: "MPLS forward", d: "The label is swapped and the packet goes to the next hop with no IP processing at all (P-router behaviour)." },
  { id: "dec_out", s: "para", x: 1010, y: 620, w: 100, h: 40, L: "mpls", t: "MPLS\ndecision", d: "The outgoing route has an MPLS binding, or the out-interface is VPLS/TE. Pick the label to impose.", m: "/mpls ldp · /mpls traffic-eng" },
  { id: "push", s: "box", x: 880, y: 620, w: 100, h: 40, L: "mpls", t: "Push label", sub: "MPLS output", d: "A label is added before the packet goes to the out-interface." },
  { id: "portal_g", s: "portal", x: 1010, y: 700, w: 132, h: 22, L: "mpls", t: "from Encap (VPLS/TE)", d: "Traffic encapsulated into a VPLS or TE tunnel gets its MPLS label here." },
  { id: "q_mpls_out", s: "decision", x: 1115, y: 780, w: 110, h: 54, L: "sw", t: "MPLS\nlabel?", d: "Should the packet leave with an MPLS label (an LDP or TE binding to the next hop)? Yes: impose a label. No: continue." },
  { id: "q_outbr", s: "decision", x: 715, y: 780, w: 110, h: 54, L: "sw", t: "Out-iface\nbridge port?", d: "Is the out-interface a bridge? Yes: the bridge picks the port (bridge output path). No: continue." },

  { id: "r_pre", s: "chain", chain: "prerouting", x: 1205, y: 180, w: 110, h: 36, L: "l3", t: "PREROUTING", d: chainDesc("prerouting") },
  { id: "r_decrypt", s: "box", x: 1345, y: 180, w: 110, h: 36, L: "l3", t: "IPsec\ndecryption", d: "The ESP/AH payload is decrypted, and the inner packet starts again at Prerouting as a new packet.", m: "/ip ipsec" },
  { id: "ipsec_in", s: "decision", x: 1485, y: 180, w: 110, h: 50, L: "sw", t: "IPsec\npolicy?", d: "Does the packet match an IPsec policy (ESP/AH to this router)? Yes: decrypt it. No: continue.", m: "/ip ipsec policy" },
  { id: "rd_in", s: "para", x: 1300, y: 265, w: 120, h: 40, L: "l3", t: "Routing\ndecision", d: "Route lookup on the destination, using routing marks and routing rules. If it is one of the router's own addresses it goes to Input, otherwise to Forward.", m: "/ip route · /routing rule" },
  { id: "r_input", s: "chain", chain: "input", x: 1485, y: 265, w: 110, h: 36, L: "l3", t: "INPUT", d: chainDesc("input") },
  { id: "r_forward", s: "chain", chain: "forward", x: 1300, y: 400, w: 110, h: 36, L: "l3", t: "FORWARD", d: chainDesc("forward") },
  { id: "r_post", s: "chain", chain: "postrouting", x: 1300, y: 540, w: 120, h: 36, L: "l3", t: "POSTROUTING", d: chainDesc("postrouting") },
  { id: "r_output", s: "chain", chain: "output", x: 1470, y: 540, w: 110, h: 36, L: "l3", t: "OUTPUT", d: chainDesc("output") },
  { id: "rd_out", s: "para", x: 1470, y: 625, w: 120, h: 40, L: "l3", t: "Routing\ndecision", d: "Route lookup for packets the router generates or has just encrypted. Picks the out-interface and source address.", m: "/ip route · /routing rule" },
  { id: "ipsec_out", s: "decision", x: 1300, y: 625, w: 110, h: 50, L: "sw", t: "IPsec\npolicy?", d: "Does the packet match an IPsec policy? Yes: encrypt it, and the new ESP packet is routed again through Output and Postrouting. No: continue to the out-interface.", m: "/ip ipsec policy" },
  { id: "r_encrypt", s: "box", x: 1300, y: 705, w: 110, h: 34, L: "l3", t: "IPsec\nencryption", d: "The packet is encrypted and wrapped in a new ESP/AH header using the SA's addresses.", m: "/ip ipsec" },

  { id: "local_in", s: "hex", x: 1700, y: 180, w: 112, h: 36, L: "loc", t: "LOCAL IN", d: "Handed to the router's own network stack." },
  { id: "proc", s: "box", x: 1700, y: 320, w: 112, h: 40, L: "loc", t: "Router\nprocesses", d: "Router services: Winbox/SSH, DNS, DHCP, BGP/OSPF, VPN servers, ping replies…" },
  { id: "local_out", s: "hex", x: 1700, y: 460, w: 112, h: 36, L: "loc", t: "LOCAL OUT", d: "Packets the router generates (replies, pings, routing updates, encapsulated tunnel packets) start here." },
  { id: "q_ip_out", s: "decision", x: 1600, y: 780, w: 110, h: 54, L: "sw", t: "IPv4 /\nIPv6?", d: "Is this router-generated traffic IP? Yes: route it through Output. No (for example non-IP L2 traffic): go straight to the out-interface checks." },

  { id: "q_encap", s: "decision", x: 250, y: 780, w: 130, h: 54, L: "sw", t: "Encapsulate?", d: "Is the out-interface logical (VLAN, EoIP, GRE, IPIP, VPLS…)? Yes: interface queue, then encapsulate and come back in as router-generated traffic. No: transmit on the physical port." },
  { id: "htb1", s: "box", x: 95, y: 780, w: 120, h: 36, L: "if", c: "--sw", t: "Interface HTB", d: "Per-interface queues (queue tree with parent=<interface>, interface queue type). The last shaping point before the wire.", m: "/queue tree parent=<interface>" },
  { id: "out_phys", s: "pill", x: 95, y: 868, w: 130, h: 38, L: "if", c: "--out", t: "Physical\nout-interface", d: "The frame is transmitted on the physical port." },
  { id: "htb2", s: "box", x: 360, y: 868, w: 110, h: 34, L: "if", c: "--sw", t: "Interface HTB", d: "Queue on the logical out-interface.", m: "/queue tree parent=<interface>" },
  { id: "log_out", s: "pill", x: 530, y: 868, w: 140, h: 34, L: "if", c: "--logic", t: "Logical out-interface", d: "The packet is sent through a virtual interface, which passes it to encapsulation." },
  { id: "encapsulation", s: "box", x: 720, y: 868, w: 140, h: 34, L: "sw", t: "Encapsulation", sub: "VLAN · tunnel · VPLS · TE", d: "An outer header is added (VLAN tag, EoIP/GRE/IPIP header, VPLS/TE label). The result is processed again as router-generated traffic from Local Out, or by MPLS for VPLS/TE." },
];

export const EDGES: Edge[] = [
  ["in_phys", "q_inbr", [[155, 95], [185, 95]]],
  ["in_log", "q_inbr", [[250, 45], [250, 68]]],
  ["q_inbr", "br_dstnat", [[250, 122], [250, 222]], "yes"],
  ["q_inbr", "q_mpls_in", [[315, 95], [665, 95]], "no"],
  ["br_dstnat", "br_ipfw1", [[300, 240], [325, 240]]],
  ["br_ipfw1", "br_pre", [[380, 215], [380, 188]], "yes"],
  ["br_ipfw1", "br_decision", [[435, 240], [478, 240]], "no"],
  ["br_pre", "br_decision", [[435, 170], [530, 170], [530, 220]]],
  ["br_decision", "br_input", [[582, 240], [610, 240]]],
  ["br_input", "q_mpls_in", [[650, 222], [650, 95], [665, 95]]],
  ["br_decision", "br_forward", [[530, 260], [530, 332]]],
  ["br_forward", "br_ipfw2", [[530, 368], [530, 415]]],
  ["br_ipfw2", "br_fwd", [[580, 440], [608, 440]], "yes"],
  ["br_ipfw2", "br_srcnat", [[530, 465], [530, 542]], "no"],
  ["br_fwd", "br_srcnat", [[650, 458], [650, 560], [585, 560]]],
  ["q_outbr", "br_decision_out", [[715, 753], [715, 660], [686, 660]], "yes"],
  ["br_decision_out", "br_output", [[592, 660], [560, 660]]],
  ["br_output", "br_srcnat", [[510, 642], [510, 578]]],
  ["br_srcnat", "br_ipfw3", [[475, 560], [435, 560]]],
  ["br_ipfw3", "br_post", [[380, 585], [380, 632]], "yes"],
  ["br_ipfw3", "q_encap", [[325, 560], [250, 560], [250, 753]], "no"],
  ["br_post", "q_encap", [[380, 668], [380, 712], [250, 712], [250, 753]]],
  ["q_mpls_in", "dec_in", [[720, 122], [720, 220], [752, 220]], "yes"],
  ["q_mpls_in", "q_ip_in", [[775, 95], [1060, 95]], "no"],
  ["dec_in", "pop", [[848, 220], [880, 220]]],
  ["pop", "vpls", [[930, 240], [930, 275]]],
  ["vpls", "portal_decap", [[930, 325], [930, 355]], "yes"],
  ["vpls", "q_ip_in", [[980, 300], [1030, 300], [1030, 95], [1060, 95]], "no"],
  ["dec_in", "switch", [[800, 240], [800, 400]]],
  ["switch", "q_outbr", [[800, 440], [800, 780], [770, 780]]],
  ["q_mpls_out", "dec_out", [[1115, 753], [1115, 620], [1058, 620]], "yes"],
  ["portal_g", "dec_out", [[1010, 689], [1010, 640]]],
  ["dec_out", "push", [[962, 620], [930, 620]]],
  ["push", "q_outbr", [[830, 620], [800, 620], [800, 780], [770, 780]]],
  ["q_mpls_out", "q_outbr", [[1060, 780], [770, 780]], "no"],
  ["q_outbr", "q_encap", [[660, 780], [315, 780]], "no"],
  ["q_ip_in", "r_pre", [[1115, 122], [1115, 180], [1150, 180]], "yes"],
  ["q_ip_in", "q_decap", [[1170, 95], [1425, 95]], "no"],
  ["r_pre", "rd_in", [[1205, 198], [1205, 265], [1243, 265]]],
  ["rd_in", "r_input", [[1357, 265], [1430, 265]]],
  ["rd_in", "r_forward", [[1300, 285], [1300, 382]]],
  ["r_input", "ipsec_in", [[1485, 247], [1485, 205]]],
  ["ipsec_in", "r_decrypt", [[1430, 180], [1400, 180]], "yes"],
  ["r_decrypt", "r_pre", [[1290, 180], [1260, 180]]],
  ["ipsec_in", "q_decap", [[1485, 155], [1485, 122]], "no"],
  ["q_decap", "decapsulation", [[1485, 68], [1485, 45]], "yes"],
  ["decapsulation", "in_log", [[1410, 30], [325, 30]]],
  ["q_decap", "local_in", [[1545, 95], [1700, 95], [1700, 162]], "no"],
  ["local_in", "proc", [[1700, 198], [1700, 300]]],
  ["proc", "local_out", [[1700, 340], [1700, 442]]],
  ["local_out", "q_ip_out", [[1700, 478], [1700, 780], [1655, 780]]],
  ["q_ip_out", "rd_out", [[1600, 753], [1600, 625], [1527, 625]], "yes"],
  ["q_ip_out", "q_mpls_out", [[1545, 780], [1170, 780]], "no"],
  ["rd_out", "r_output", [[1470, 605], [1470, 558]]],
  ["r_output", "r_post", [[1415, 540], [1360, 540]]],
  ["r_forward", "r_post", [[1300, 418], [1300, 522]]],
  ["r_post", "ipsec_out", [[1300, 558], [1300, 600]]],
  ["ipsec_out", "r_encrypt", [[1300, 650], [1300, 688]], "yes"],
  ["r_encrypt", "rd_out", [[1355, 705], [1470, 705], [1470, 645]]],
  ["ipsec_out", "q_mpls_out", [[1245, 625], [1190, 625], [1190, 780], [1170, 780]], "no"],
  ["q_encap", "htb1", [[185, 780], [155, 780]], "no"],
  ["htb1", "out_phys", [[95, 798], [95, 849]]],
  ["q_encap", "htb2", [[250, 807], [250, 868], [305, 868]], "yes"],
  ["htb2", "log_out", [[415, 868], [460, 868]]],
  ["log_out", "encapsulation", [[600, 868], [650, 868]]],
  ["encapsulation", "local_out", [[790, 868], [1790, 868], [1790, 460], [1756, 460]]],
];

/* ---------------- helpers ---------------- */

export const byId: Record<string, FlowNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));
export const edgeKey = (from: string, to: string) => `${from}>${to}`;
export const edgeMap: Record<string, Edge> = Object.fromEntries(EDGES.map((e) => [edgeKey(e[0], e[1]), e]));

export const plain = (t: string) => t.replace(/\n/g, " ").replace(/- /g, "-");
export const nodeColor = (n: Pick<FlowNode, "c" | "L">) => n.c ?? LAYERS[n.L].c;

export interface Route {
  pts: Point[];
  cum: number[];
  /** distance along the route at which each step's node is reached */
  stepD: number[];
  total: number;
}

/** Polyline through every edge of a scenario; missing edges (portal jumps) are zero-length teleports. */
export function buildRoute(p: string[]): Route {
  const first = byId[p[0]];
  const pts: Point[] = [[first.x, first.y]];
  const jumps = new Set<number>();
  const at = [0];
  for (let i = 1; i < p.length; i++) {
    const e = edgeMap[edgeKey(p[i - 1], p[i])];
    const n = byId[p[i]];
    if (e) e[2].forEach((q) => pts.push(q));
    else jumps.add(pts.length);
    pts.push([n.x, n.y]);
    at.push(pts.length - 1);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const d = jumps.has(i) ? 0 : Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cum.push(cum[i - 1] + d);
  }
  return { pts, cum, stepD: at.map((i) => cum[i]), total: cum[cum.length - 1] };
}

export function pointAt({ pts, cum }: Route, d: number): Point {
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= d) {
      const seg = cum[i] - cum[i - 1] || 1;
      const t = (d - cum[i - 1]) / seg;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
  }
  return pts[pts.length - 1];
}
