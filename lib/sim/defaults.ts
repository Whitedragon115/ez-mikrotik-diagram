// A home/office-style default config (close to RouterOS defconf) plus packet presets.
import type { PacketInput, RouterConfig, Rule } from "./types";

let n = 0;
const r = (x: Omit<Rule, "id">): Rule => ({ id: `d${n++}`, ...x });

export function defaultConfig(): RouterConfig {
  n = 0;
  return {
    identity: "MikroTik",
    interfaces: [
      { name: "ether1", type: "ether", comment: "WAN" },
      { name: "ether2", type: "ether", bridge: "bridge" },
      { name: "ether3", type: "ether", bridge: "bridge" },
      { name: "ether4", type: "ether", bridge: "bridge" },
      { name: "ether5", type: "ether", comment: "DMZ" },
      { name: "bridge", type: "bridge", comment: "LAN" },
      { name: "vlan10", type: "vlan", vlanId: 10, parent: "bridge", comment: "Guests" },
      { name: "gre-site-b", type: "gre", local: "203.0.113.10", remote: "198.51.100.2", comment: "Tunnel to branch" },
    ],
    addresses: [
      { address: "203.0.113.10/24", interface: "ether1" },
      { address: "192.168.88.1/24", interface: "bridge" },
      { address: "192.168.10.1/24", interface: "vlan10" },
      { address: "172.16.5.1/24", interface: "ether5" },
      { address: "10.255.0.1/30", interface: "gre-site-b" },
    ],
    routes: [
      { dst: "0.0.0.0/0", gateway: "203.0.113.1", distance: 1, table: "main", comment: "Default route" },
      { dst: "10.20.0.0/16", gateway: "10.255.0.2", distance: 1, table: "main", comment: "Branch LAN via GRE" },
    ],
    interfaceLists: [
      { name: "WAN", members: "ether1" },
      { name: "LAN", members: "bridge,vlan10,ether5,gre-site-b" },
    ],
    addressLists: [{ list: "blocked", address: "45.33.32.156" }],
    bridgeHosts: [
      { ip: "192.168.88.10", bridge: "bridge", port: "ether2" },
      { ip: "192.168.88.20", bridge: "bridge", port: "ether3" },
    ],
    bridge: { useIpFirewall: false },
    ipsecPolicies: [],
    simpleQueues: [{ name: "pc-10", target: "192.168.88.10/32", maxLimit: "20M/50M" }],
    queueTrees: [],
    rules: {
      raw: [r({ chain: "prerouting", action: "drop", srcAddressList: "blocked", comment: "drop blocked hosts early" })],
      mangle: [],
      nat: [
        r({ chain: "srcnat", action: "masquerade", outInterfaceList: "WAN", comment: "defconf: masquerade" }),
        r({ chain: "dstnat", action: "dst-nat", protocol: "tcp", dstPort: "8080", inInterfaceList: "WAN", toAddresses: "192.168.88.20", toPorts: "80", comment: "port forward to web server" }),
      ],
      filter: [
        r({ chain: "input", action: "accept", connectionState: "established,related,untracked", comment: "defconf: accept established,related,untracked" }),
        r({ chain: "input", action: "drop", connectionState: "invalid", comment: "defconf: drop invalid" }),
        r({ chain: "input", action: "accept", protocol: "icmp", comment: "defconf: accept ICMP" }),
        r({ chain: "input", action: "accept", protocol: "gre", inInterfaceList: "WAN", comment: "allow GRE from branch" }),
        r({ chain: "input", action: "drop", inInterfaceList: "!LAN", comment: "defconf: drop all not coming from LAN" }),
        r({ chain: "forward", action: "accept", connectionState: "established,related,untracked", comment: "defconf: accept established,related,untracked" }),
        r({ chain: "forward", action: "drop", connectionState: "invalid", comment: "defconf: drop invalid" }),
        r({ chain: "forward", action: "drop", connectionState: "new", connectionNatState: "!dstnat", inInterfaceList: "WAN", comment: "defconf: drop all from WAN not DSTNATed" }),
      ],
      "bridge-filter": [],
      "bridge-nat": [],
    },
  };
}

const base: PacketInput = {
  origin: "iface",
  inInterface: "ether2",
  src: "192.168.88.10",
  dst: "1.1.1.1",
  proto: "tcp",
  sport: "51000",
  dport: "443",
  ttl: 64,
  encap: "none",
  vlanId: 10,
  outerSrc: "",
  outerDst: "",
};

export const defaultPacket = (): PacketInput => ({ ...base });

export const PRESETS: { name: string; desc: string; p: PacketInput }[] = [
  { name: "LAN → Internet", desc: "PC browses a website; routed, masqueraded.", p: { ...base } },
  { name: "Port forward", desc: "Internet client hits WAN:8080, DST-NAT to 192.168.88.20:80.", p: { ...base, inInterface: "ether1", src: "198.51.100.77", dst: "203.0.113.10", sport: "40000", dport: "8080" } },
  { name: "Blocked from WAN", desc: "Internet host tries SSH to the router.", p: { ...base, inInterface: "ether1", src: "198.51.100.77", dst: "203.0.113.10", sport: "40000", dport: "22" } },
  { name: "LAN → LAN (bridged)", desc: "Two PCs on the same bridge.", p: { ...base, dst: "192.168.88.20", dport: "445" } },
  { name: "Ping the router", desc: "PC pings its gateway.", p: { ...base, dst: "192.168.88.1", proto: "icmp", sport: "", dport: "" } },
  { name: "Router → DNS", desc: "The router itself queries a DNS server.", p: { ...base, origin: "local", src: "", dst: "8.8.8.8", proto: "udp", sport: "40123", dport: "53" } },
  { name: "LAN → branch (GRE)", desc: "Routed into a GRE tunnel, then encapsulated.", p: { ...base, dst: "10.20.0.50", dport: "3389" } },
  { name: "Branch → LAN (GRE in)", desc: "GRE packet from the branch is decapsulated.", p: { ...base, inInterface: "ether1", src: "10.20.0.50", dst: "192.168.88.10", sport: "3389", dport: "51000", encap: "gre", outerSrc: "198.51.100.2", outerDst: "203.0.113.10" } },
  { name: "Guest VLAN 10", desc: "Tagged frame on a bridge port reaches vlan10.", p: { ...base, src: "192.168.10.50", encap: "vlan", vlanId: 10 } },
  { name: "Blocked address list", desc: "Packet from an address in list 'blocked' (raw drop).", p: { ...base, inInterface: "ether1", src: "45.33.32.156", dst: "203.0.113.10", dport: "80" } },
];
