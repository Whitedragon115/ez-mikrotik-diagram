// Ready-made router setups, each with test packets that show off what it does.
import { defaultConfig, defaultPacket } from "./defaults";
import { newId } from "./rules";
import type { PacketInput, RouterConfig, Rule } from "./types";

export interface TemplatePacket {
  name: string;
  desc: string;
  p: PacketInput;
}

export interface Template {
  id: string;
  name: string;
  desc: string;
  build: () => RouterConfig;
  packets: TemplatePacket[];
}

const r = (x: Omit<Rule, "id">): Rule => ({ id: newId(), ...x });
const pk = (o: Partial<PacketInput>): PacketInput => ({ ...defaultPacket(), ...o });

/** Insert rules before the first rule of a chain (so they win over defconf drops). */
function prepend(rules: Rule[], chain: string, add: Rule[]) {
  const i = rules.findIndex((x) => x.chain === chain);
  rules.splice(i < 0 ? rules.length : i, 0, ...add);
}

export interface PortForward {
  protocol: "tcp" | "udp";
  extPort: string;
  intAddress: string;
  intPort: string;
  wanIp: string;
  hairpin: boolean;
  lanSubnet: string;
  comment: string;
}

/** DST-NAT port forward (+ optional hairpin NAT so LAN clients can use the public address). */
export function portForwardRules(f: PortForward): { nat: Rule[] } {
  const nat: Rule[] = [
    r({
      chain: "dstnat", action: "dst-nat", protocol: f.protocol, dstPort: f.extPort,
      ...(f.hairpin ? { dstAddress: f.wanIp } : { inInterfaceList: "WAN" }),
      toAddresses: f.intAddress, toPorts: f.intPort || undefined, comment: f.comment || `forward ${f.protocol}/${f.extPort}`,
    }),
  ];
  if (f.hairpin)
    nat.unshift(
      r({ chain: "srcnat", action: "masquerade", srcAddress: f.lanSubnet, dstAddress: f.intAddress, protocol: f.protocol, dstPort: f.intPort || f.extPort, comment: "hairpin NAT" }),
    );
  return { nat };
}

export const TEMPLATES: Template[] = [
  {
    id: "home",
    name: "Home router (defconf)",
    desc: "WAN on ether1, LAN bridge, masquerade, the default firewall, one port forward.",
    build: defaultConfig,
    packets: [],
  },
  {
    id: "servers",
    name: "Port forwarding + hairpin NAT",
    desc: "Web, SSH and game ports forwarded to LAN servers; hairpin NAT so LAN clients can use the public IP.",
    build: () => {
      const c = defaultConfig();
      c.rules.nat = c.rules.nat.filter((x) => x.chain !== "dstnat");
      c.bridgeHosts.push({ ip: "192.168.88.30", bridge: "bridge", port: "ether4" });
      const fw = [
        { protocol: "tcp", extPort: "80,443", intAddress: "192.168.88.20", intPort: "", comment: "web server" },
        { protocol: "tcp", extPort: "2222", intAddress: "192.168.88.30", intPort: "22", comment: "SSH to NAS" },
        { protocol: "udp", extPort: "27015", intAddress: "192.168.88.30", intPort: "", comment: "game server" },
      ] as const;
      for (const f of fw) c.rules.nat.push(...portForwardRules({ ...f, wanIp: "203.0.113.10", hairpin: false, lanSubnet: "192.168.88.0/24" }).nat);
      // hairpin for the web server: match on the public address instead of the WAN interface
      c.rules.nat.unshift(r({ chain: "srcnat", action: "masquerade", srcAddress: "192.168.88.0/24", dstAddress: "192.168.88.20", protocol: "tcp", dstPort: "80,443", comment: "hairpin NAT" }));
      c.rules.nat.push(r({ chain: "dstnat", action: "dst-nat", protocol: "tcp", dstPort: "80,443", dstAddress: "203.0.113.10", inInterfaceList: "LAN", toAddresses: "192.168.88.20", comment: "hairpin: LAN → public IP" }));
      return c;
    },
    packets: [
      { name: "Internet → web (443)", desc: "DST-NAT to 192.168.88.20", p: pk({ inInterface: "ether1", src: "198.51.100.77", dst: "203.0.113.10", sport: "40000", dport: "443" }) },
      { name: "Internet → SSH 2222", desc: "DST-NAT to NAS port 22", p: pk({ inInterface: "ether1", src: "198.51.100.77", dst: "203.0.113.10", sport: "40001", dport: "2222" }) },
      { name: "Internet → closed port", desc: "Dropped by the router's input chain", p: pk({ inInterface: "ether1", src: "198.51.100.77", dst: "203.0.113.10", sport: "40002", dport: "3389" }) },
      { name: "LAN → public IP (hairpin)", desc: "DST-NAT + hairpin masquerade", p: pk({ inInterface: "ether2", src: "192.168.88.10", dst: "203.0.113.10", sport: "52000", dport: "443" }) },
    ],
  },
  {
    id: "dualwan",
    name: "Dual WAN, policy routing",
    desc: "Two ISPs. One PC is sent over WAN2 with mangle mark-routing, a server with a /routing rule; both use a second routing table.",
    build: () => {
      const c = defaultConfig();
      c.interfaces.find((i) => i.name === "ether5")!.comment = "WAN2";
      c.addresses = c.addresses.map((a) => (a.interface === "ether5" ? { address: "198.18.0.10/24", interface: "ether5" } : a));
      c.routes.push({ dst: "0.0.0.0/0", gateway: "198.18.0.1", distance: 1, table: "to_wan2", comment: "WAN2 default" });
      c.routes.push({ dst: "0.0.0.0/0", gateway: "198.18.0.1", distance: 2, table: "main", comment: "WAN2 backup" });
      c.interfaceLists = [
        { name: "WAN", members: "ether1,ether5" },
        { name: "LAN", members: "bridge,vlan10,gre-site-b" },
      ];
      c.rules.mangle = [
        r({ chain: "prerouting", action: "mark-routing", srcAddress: "192.168.88.20", dstAddressList: "!local-nets", newRoutingMark: "to_wan2", passthrough: false, comment: "PC .20 uses WAN2" }),
      ];
      c.addressLists.push({ list: "local-nets", address: "192.168.0.0/16" }, { list: "local-nets", address: "10.0.0.0/8" });
      c.routingRules = [
        { dstAddress: "192.168.0.0/16", action: "lookup-only-in-table", table: "main", comment: "LAN traffic never leaves via WAN2" },
        { srcAddress: "192.168.88.30", action: "lookup", table: "to_wan2", comment: "server .30 uses WAN2" },
      ];
      return c;
    },
    packets: [
      { name: "PC .10 → Internet", desc: "Main table → WAN1", p: pk({ src: "192.168.88.10" }) },
      { name: "PC .20 → Internet", desc: "mark-routing → table to_wan2 → WAN2", p: pk({ inInterface: "ether3", src: "192.168.88.20" }) },
      { name: "PC .20 → LAN server", desc: "Excluded by address list, stays local", p: pk({ inInterface: "ether3", src: "192.168.88.20", dst: "192.168.10.50", dport: "80" }) },
      { name: "Server .30 → Internet", desc: "/routing rule src .30 → table to_wan2 → WAN2", p: pk({ inInterface: "ether4", src: "192.168.88.30" }) },
      { name: "Server .30 → LAN", desc: "First routing rule keeps LAN traffic in main", p: pk({ inInterface: "ether4", src: "192.168.88.30", dst: "192.168.10.50", dport: "80" }) },
    ],
  },
  {
    id: "guest",
    name: "Guest VLAN isolation",
    desc: "Guests on VLAN 10 get Internet only, with no access to the LAN or the router.",
    build: () => {
      const c = defaultConfig();
      c.interfaceLists = [
        { name: "WAN", members: "ether1" },
        { name: "LAN", members: "bridge,ether5,gre-site-b" },
        { name: "GUEST", members: "vlan10" },
      ];
      prepend(c.rules.filter, "input", [
        r({ chain: "input", action: "accept", inInterfaceList: "GUEST", protocol: "udp", dstPort: "53,67", comment: "guests: DNS + DHCP only" }),
        r({ chain: "input", action: "drop", inInterfaceList: "GUEST", connectionState: "new", comment: "guests: no router access" }),
      ]);
      c.rules.filter.push(
        r({ chain: "forward", action: "drop", inInterfaceList: "GUEST", outInterfaceList: "!WAN", comment: "guests: Internet only" }),
      );
      return c;
    },
    packets: [
      { name: "Guest → Internet", desc: "Allowed", p: pk({ src: "192.168.10.50", encap: "vlan", vlanId: 10 }) },
      { name: "Guest → LAN PC", desc: "Dropped in forward", p: pk({ src: "192.168.10.50", dst: "192.168.88.20", dport: "445", encap: "vlan", vlanId: 10 }) },
      { name: "Guest → Winbox", desc: "Dropped in input", p: pk({ src: "192.168.10.50", dst: "192.168.10.1", dport: "8291", encap: "vlan", vlanId: 10 }) },
      { name: "Guest → DNS on router", desc: "Allowed in input", p: pk({ src: "192.168.10.50", dst: "192.168.10.1", proto: "udp", dport: "53", encap: "vlan", vlanId: 10 }) },
    ],
  },
  {
    id: "ipsec",
    name: "Site-to-site IPsec",
    desc: "LAN 192.168.88.0/24 ↔ HQ 10.30.0.0/16 over IPsec, with a NAT bypass so tunnel traffic isn't masqueraded.",
    build: () => {
      const c = defaultConfig();
      c.ipsecPolicies = [{ src: "192.168.88.0/24", dst: "10.30.0.0/16", action: "encrypt", saSrc: "203.0.113.10", saDst: "198.51.100.9" }];
      c.rules.nat.unshift(r({ chain: "srcnat", action: "accept", srcAddress: "192.168.88.0/24", dstAddress: "10.30.0.0/16", comment: "IPsec: bypass NAT" }));
      prepend(c.rules.filter, "input", [
        r({ chain: "input", action: "accept", protocol: "udp", dstPort: "500,4500", inInterfaceList: "WAN", comment: "IPsec IKE" }),
        r({ chain: "input", action: "accept", protocol: "esp", inInterfaceList: "WAN", comment: "IPsec ESP" }),
      ]);
      prepend(c.rules.filter, "forward", [
        r({ chain: "forward", action: "accept", srcAddress: "10.30.0.0/16", dstAddress: "192.168.88.0/24", comment: "from HQ over IPsec" }),
      ]);
      return c;
    },
    packets: [
      { name: "LAN → HQ (encrypt)", desc: "Matches policy, ESP to 198.51.100.9", p: pk({ dst: "10.30.1.5", dport: "445" }) },
      { name: "HQ → LAN (decrypt)", desc: "ESP arrives, decrypted, forwarded", p: pk({ inInterface: "ether1", src: "10.30.1.5", dst: "192.168.88.10", sport: "445", dport: "51000", encap: "esp", outerSrc: "198.51.100.9", outerDst: "203.0.113.10" }) },
      { name: "LAN → Internet", desc: "No policy, masqueraded as usual", p: pk({}) },
    ],
  },
  {
    id: "bridgefw",
    name: "Bridge firewall",
    desc: "use-ip-firewall=yes, so the IP firewall filters traffic between ports of the same bridge.",
    build: () => {
      const c = defaultConfig();
      c.bridge.useIpFirewall = true;
      c.bridgeHosts.push({ ip: "192.168.88.30", bridge: "bridge", port: "ether4" });
      prepend(c.rules.filter, "forward", [
        r({ chain: "forward", action: "drop", protocol: "tcp", dstPort: "445", srcAddress: "192.168.88.0/24", dstAddress: "192.168.88.0/24", comment: "no SMB between LAN hosts" }),
      ]);
      c.rules["bridge-filter"] = [r({ chain: "forward", action: "drop", inInterface: "ether4", outInterface: "ether2", comment: "L2: isolate port 4 from port 2" })];
      return c;
    },
    packets: [
      { name: "PC → PC SMB", desc: "Bridged, dropped by IP filter", p: pk({ dst: "192.168.88.20", dport: "445" }) },
      { name: "PC → PC web", desc: "Bridged and allowed", p: pk({ dst: "192.168.88.20", dport: "80" }) },
      { name: "Port 4 → port 2", desc: "Dropped by the bridge filter", p: pk({ inInterface: "ether4", src: "192.168.88.30", dst: "192.168.88.10", dport: "80" }) },
    ],
  },
  {
    id: "qos",
    name: "QoS: mangle + queue tree",
    desc: "Marks web and VoIP traffic with mangle, then shapes it with queue trees.",
    build: () => {
      const c = defaultConfig();
      c.rules.mangle = [
        r({ chain: "forward", action: "mark-connection", protocol: "tcp", dstPort: "80,443", connectionState: "new", newConnectionMark: "web", comment: "classify web" }),
        r({ chain: "forward", action: "mark-connection", protocol: "udp", dstPort: "5060-5070,10000-20000", connectionState: "new", newConnectionMark: "voip", comment: "classify VoIP" }),
        r({ chain: "forward", action: "mark-packet", connectionMark: "web", newPacketMark: "web-pkt", passthrough: false }),
        r({ chain: "forward", action: "mark-packet", connectionMark: "voip", newPacketMark: "voip-pkt", passthrough: false }),
      ];
      c.queueTrees = [
        { name: "web", parent: "global", packetMark: "web-pkt", maxLimit: "50M" },
        { name: "voip", parent: "global", packetMark: "voip-pkt", maxLimit: "5M" },
      ];
      c.simpleQueues = [];
      return c;
    },
    packets: [
      { name: "Web traffic", desc: "connection-mark=web → queue web", p: pk({}) },
      { name: "VoIP call", desc: "connection-mark=voip → queue voip", p: pk({ proto: "udp", dport: "5060", sport: "5060" }) },
      { name: "Other traffic", desc: "No mark, no queue", p: pk({ dport: "22" }) },
    ],
  },
];
