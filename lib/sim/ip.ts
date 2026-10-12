// IPv4 helpers: parsing, prefix/range matching, port specs.

export function ipToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export const isIp = (s: string) => ipToInt(s) !== null;

const mask = (len: number) => (len === 0 ? 0 : (~0 << (32 - len)) >>> 0);

export interface Range {
  lo: number;
  hi: number;
  len: number;
}

/** "10.0.0.0/8", "1.2.3.4", "1.2.3.4-1.2.3.9" */
export function parseRange(spec: string): Range | null {
  const s = spec.trim();
  if (s.includes("-")) {
    const [a, b] = s.split("-").map((x) => ipToInt(x));
    if (a === null || b === null) return null;
    return { lo: Math.min(a, b), hi: Math.max(a, b), len: 32 };
  }
  const [ip, l] = s.split("/");
  const n = ipToInt(ip);
  const len = l === undefined ? 32 : Number(l);
  if (n === null || !Number.isInteger(len) || len < 0 || len > 32) return null;
  const lo = (n & mask(len)) >>> 0;
  return { lo, hi: (lo | (~mask(len) >>> 0)) >>> 0, len };
}

export function inRange(ip: string, spec: string): boolean {
  const n = ipToInt(ip);
  const r = parseRange(spec);
  return n !== null && r !== null && n >= r.lo && n <= r.hi;
}

/** Interface address "192.168.88.1/24" → network info */
export function ifaceNet(address: string) {
  const [ip, l] = address.split("/");
  const len = l === undefined ? 32 : Number(l);
  const r = parseRange(`${ip}/${len}`);
  return r && { ip, len, network: `${intToIp(r.lo)}/${len}` };
}

/** Connected networks of an address: its subnet, plus the peer's /32 for point-to-point addresses (network=). */
export function connectedNets(a: { address: string; network?: string }): string[] {
  const own = ifaceNet(a.address);
  if (!own) return [];
  const peer = own.len === 32 && a.network && isIp(a.network) && a.network !== own.ip ? [`${a.network}/32`] : [];
  return [own.network, ...peer];
}

/** RouterOS gateway: "10.0.0.1", "pppoe-out1" or "10.0.0.1%pppoe-out1" */
export function splitGateway(gw: string): { ip?: string; iface?: string } {
  const i = gw.indexOf("%");
  if (i >= 0) return { ip: isIp(gw.slice(0, i)) ? gw.slice(0, i) : undefined, iface: gw.slice(i + 1) || undefined };
  return isIp(gw) ? { ip: gw } : { iface: gw || undefined };
}

export function validPrefix(spec: string) {
  return parseRange(spec) !== null;
}

/** "80", "80,443", "1000-2000", "!22" */
export function portMatch(port: number | undefined, spec: string): boolean {
  if (port === undefined) return false;
  return spec.split(",").some((part) => {
    const [a, b] = part.trim().split("-").map(Number);
    if (Number.isNaN(a)) return false;
    return b === undefined || Number.isNaN(b) ? port === a : port >= a && port <= b;
  });
}

export function parsePort(s: string): number | undefined {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined;
}

/** Split a "!value" negation */
export function neg(spec: string): [boolean, string] {
  const s = spec.trim();
  return s.startsWith("!") ? [true, s.slice(1).trim()] : [false, s];
}
