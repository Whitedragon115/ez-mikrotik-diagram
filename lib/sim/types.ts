// Data model for the simulated RouterOS router.

export type Proto = "tcp" | "udp" | "icmp" | "gre" | "ipip" | "esp";
export type IfaceType = "ether" | "bridge" | "vlan" | "gre" | "ipip" | "eoip";

export interface Iface {
  name: string;
  type: IfaceType;
  /** bridge this interface is a port of */
  bridge?: string;
  /** vlan: tag and parent interface */
  vlanId?: number;
  parent?: string;
  /** tunnels: endpoints */
  local?: string;
  remote?: string;
  disabled?: boolean;
  comment?: string;
}

export interface Address {
  address: string; // 192.168.88.1/24
  interface: string;
  /** point-to-point peer of a /32 address (RouterOS network=), e.g. the PPPoE server; adds a connected route to it */
  network?: string;
  disabled?: boolean;
}

export interface Route {
  dst: string;
  gateway: string; // IP, interface name, or "IP%interface" (next hop reached through that interface)
  distance: number;
  table: string;
  disabled?: boolean;
  comment?: string;
}

export type RoutingRuleAction = "lookup" | "lookup-only-in-table" | "drop" | "unreachable";

/** /routing rule: policy routing, checked in order before the normal route lookup. */
export interface RoutingRule {
  srcAddress?: string;
  dstAddress?: string;
  routingMark?: string;
  /** in-interface */
  interface?: string;
  action: RoutingRuleAction;
  table: string;
  disabled?: boolean;
  comment?: string;
}

export interface IfaceList {
  name: string;
  members: string; // comma separated interface names
}

export interface AddrListEntry {
  list: string;
  address: string;
}

/** Simplified bridge host (MAC) table: which port an IP's MAC was learned on. */
export interface BridgeHost {
  ip: string;
  bridge: string;
  port: string;
}

export interface IpsecPolicy {
  src: string;
  dst: string;
  action: "encrypt" | "discard" | "none";
  saSrc: string;
  saDst: string;
  disabled?: boolean;
}

export interface SimpleQueue {
  name: string;
  target: string;
  maxLimit: string;
  disabled?: boolean;
}

export interface QueueTree {
  name: string;
  parent: string; // "global" or interface
  packetMark: string;
  maxLimit: string;
  disabled?: boolean;
}

export type Table = "filter" | "nat" | "mangle" | "raw" | "bridge-filter" | "bridge-nat";

export interface Rule {
  id: string;
  chain: string;
  action: string;
  disabled?: boolean;
  comment?: string;
  // matchers
  srcAddress?: string;
  dstAddress?: string;
  protocol?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  inInterfaceList?: string;
  outInterfaceList?: string;
  srcAddressList?: string;
  dstAddressList?: string;
  connectionState?: string;
  connectionNatState?: string;
  srcAddressType?: string;
  dstAddressType?: string;
  ipsecPolicy?: string;
  packetMark?: string;
  connectionMark?: string;
  routingMark?: string;
  // action parameters
  toAddresses?: string;
  toPorts?: string;
  newPacketMark?: string;
  newConnectionMark?: string;
  newRoutingMark?: string;
  newTtl?: string;
  passthrough?: boolean;
}

export interface RouterConfig {
  identity: string;
  interfaces: Iface[];
  addresses: Address[];
  routes: Route[];
  /** optional so configs saved before routing rules existed still load */
  routingRules?: RoutingRule[];
  interfaceLists: IfaceList[];
  addressLists: AddrListEntry[];
  bridgeHosts: BridgeHost[];
  bridge: { useIpFirewall: boolean };
  ipsecPolicies: IpsecPolicy[];
  simpleQueues: SimpleQueue[];
  queueTrees: QueueTree[];
  rules: Record<Table, Rule[]>;
}

export type Encap = "none" | "vlan" | "gre" | "ipip" | "eoip" | "esp";

export interface PacketInput {
  origin: "iface" | "local";
  inInterface: string;
  src: string;
  dst: string;
  proto: Proto;
  sport: string;
  dport: string;
  ttl: number;
  encap: Encap;
  vlanId: number;
  outerSrc: string;
  outerDst: string;
}

/* ---------- runtime ---------- */

export interface Pkt {
  src: string;
  dst: string;
  proto: Proto;
  sport?: number;
  dport?: number;
  ttl: number;
  vlan?: number;
  /** payload of a tunnel packet (GRE/IPIP/EoIP/ESP) */
  inner?: Pkt;
  tunnel?: "gre" | "ipip" | "eoip" | "esp";
  packetMark?: string;
  connMark?: string;
  routingMark?: string;
}

export type ConnState = "new" | "established" | "related" | "invalid" | "untracked";

export interface Tuple {
  src: string;
  sport: number;
  dst: string;
  dport: number;
}

export interface ConnEntry {
  id: number;
  proto: Proto;
  orig: Tuple;
  reply: Tuple;
  snat?: { ip: string; port?: number };
  dnat?: { ip: string; port?: number };
  connMark?: string;
  seenReply: boolean;
  packets: number;
}

export interface RuleEval {
  ruleId: string;
  index: number;
  matched: boolean;
  why?: string;
  action?: string;
}

export interface StageResult {
  name: string;
  table?: Table;
  chain?: string;
  evals: RuleEval[];
  result: string;
  kind: "ok" | "skip" | "drop" | "change" | "info";
}

export interface PktSnap {
  src: string;
  dst: string;
  proto: Proto;
  sport?: number;
  dport?: number;
  ttl: number;
  vlan?: number;
  carries?: string;
  tunnel?: Pkt["tunnel"];
  inner?: Pick<Pkt, "src" | "dst" | "proto" | "sport" | "dport" | "ttl" | "vlan">;
  packetMark?: string;
  connMark?: string;
  routingMark?: string;
  inIface?: string;
  outIface?: string;
  nextHop?: string;
  connState?: ConnState;
}

export interface TraceStep {
  node: string;
  outcome?: "yes" | "no";
  notes: string[];
  stages?: StageResult[];
  pkt: PktSnap;
  status?: "drop" | "done" | "warn";
}

export interface SimResult {
  steps: TraceStep[];
  verdict: { kind: "forwarded" | "delivered" | "dropped" | "error"; text: string };
  /** where the packet ended up, for building a reply */
  final?: { pkt: Pkt; outIface?: string; local?: boolean; inIface?: string };
  conntrack: ConnEntry[];
  nextConnId: number;
  hits: Record<string, number>;
}
