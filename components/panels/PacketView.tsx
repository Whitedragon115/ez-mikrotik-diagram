"use client";

import type { PktSnap } from "@/lib/sim/types";

type Inner = NonNullable<PktSnap["inner"]>;

const PROTO_NO: Record<string, number> = { icmp: 1, ipip: 4, tcp: 6, udp: 17, gre: 47, esp: 50 };
const WELL_KNOWN: Record<number, string> = { 22: "SSH", 53: "DNS", 80: "HTTP", 443: "HTTPS", 445: "SMB", 3389: "RDP", 5060: "SIP", 8291: "Winbox", 8080: "HTTP-alt", 67: "DHCP", 123: "NTP", 500: "IKE", 4500: "IPsec NAT-T", 2222: "SSH-alt", 27015: "game" };

function F({ label, value, prev, wide, hint }: { label: string; value?: string | number; prev?: string | number; wide?: boolean; hint?: string }) {
  const changed = prev !== undefined && value !== undefined && prev !== value;
  return (
    <div className={["pf", changed && "chg", wide && "wide"].filter(Boolean).join(" ")} title={changed ? `was ${prev}` : hint}>
      <span className="pf-l">{label}</span>
      <span className="pf-v mono">
        {value ?? "—"}
        {hint && <small> {hint}</small>}
      </span>
      {changed && <span className="pf-was mono">{prev}</span>}
    </div>
  );
}

function L4({ p, prev, locked }: { p: Inner | PktSnap; prev?: Inner | PktSnap; locked?: boolean }) {
  if (p.proto === "tcp" || p.proto === "udp")
    return (
      <div className={`layer l4${locked ? " locked" : ""}`}>
        <div className="ly-h"><b>{p.proto.toUpperCase()}</b><span>layer 4</span></div>
        <div className="ly-f">
          <F label="src port" value={p.sport} prev={prev?.sport} hint={p.sport ? WELL_KNOWN[p.sport] : undefined} />
          <F label="dst port" value={p.dport} prev={prev?.dport} hint={p.dport ? WELL_KNOWN[p.dport] : undefined} />
          {p.proto === "tcp" && <F label="flags" value="SYN" />}
        </div>
      </div>
    );
  if (p.proto === "icmp")
    return (
      <div className={`layer l4${locked ? " locked" : ""}`}>
        <div className="ly-h"><b>ICMP</b><span>layer 4</span></div>
        <div className="ly-f"><F label="type" value="8 (echo request)" wide /></div>
      </div>
    );
  return null;
}

function Ip({ p, prev, title, locked, added }: { p: Inner | PktSnap; prev?: Inner | PktSnap; title: string; locked?: boolean; added?: boolean }) {
  return (
    <div className={`layer l3${locked ? " locked" : ""}${added ? " added" : ""}`}>
      <div className="ly-h"><b>{title}</b><span>{added ? <em className="new">added here</em> : "layer 3"}</span></div>
      <div className="ly-f">
        <F label="src address" value={p.src} prev={prev?.src} />
        <F label="dst address" value={p.dst} prev={prev?.dst} />
        <F label="TTL" value={p.ttl} prev={prev?.ttl} />
        <F label="protocol" value={`${p.proto} (${PROTO_NO[p.proto] ?? "?"})`} prev={prev ? `${prev.proto} (${PROTO_NO[prev.proto] ?? "?"})` : undefined} />
      </div>
    </div>
  );
}

/** Wireshark-style layered view of the packet at one step, highlighting fields that changed since the previous step. */
export default function PacketView({ cur, prev, step }: { cur: PktSnap; prev?: PktSnap; step: number }) {
  const tunnel = cur.tunnel && cur.inner;
  const prevSameShape = prev && !!prev.inner === !!cur.inner ? prev : undefined;
  const innerPrev = prev?.inner ?? (prev && !prev.inner ? prev : undefined);
  // headers that appear at this step (encapsulation / VLAN tagging)
  const tunnelAdded = !!prev && !!tunnel && !prev.inner;
  const vlanAdded = !!prev && cur.vlan !== undefined && prev.vlan === undefined;
  const removed = prev && prev.inner && !cur.inner ? `${prev.tunnel?.toUpperCase()} header removed` : prev && prev.vlan !== undefined && cur.vlan === undefined ? `VLAN ${prev.vlan} tag removed` : null;
  const size = 20 + (cur.proto === "tcp" ? 20 : cur.proto === "udp" ? 8 : 8) + (tunnel ? 20 + (cur.tunnel === "esp" ? 26 : cur.tunnel === "gre" ? 4 : 0) : 0) + 64;

  return (
    <div className="pktview">
      <div className="pv-head">
        <b>Packet at step {step + 1}</b>
        <span className="muted small">~{size} bytes · changed fields are highlighted</span>
      </div>

      {removed && <div className="pv-removed">− {removed}</div>}
      <div className="layer meta">
        <div className="ly-h"><b>Router's view</b><span>not on the wire</span></div>
        <div className="ly-f">
          <F label="in-interface" value={cur.inIface} prev={prev?.inIface} wide />
          {cur.outIface && <F label="out-interface" value={cur.outIface} prev={prev?.outIface} wide />}
          {cur.nextHop && <F label="next hop" value={cur.nextHop} prev={prev?.nextHop} />}
          {cur.connState && <F label="conn. state" value={cur.connState} prev={prev?.connState} />}
          {cur.packetMark && <F label="packet-mark" value={cur.packetMark} prev={prev?.packetMark} />}
          {cur.connMark && <F label="conn-mark" value={cur.connMark} prev={prev?.connMark} />}
          {cur.routingMark && <F label="routing-mark" value={cur.routingMark} prev={prev?.routingMark} />}
        </div>
      </div>

      <div className="layer l2">
        <div className="ly-h"><b>Ethernet II</b><span>layer 2</span></div>
        <div className="ly-f">
          <F label="type" value={cur.vlan !== undefined ? "0x8100 (802.1Q)" : "0x0800 (IPv4)"} wide />
        </div>
      </div>
      {cur.vlan !== undefined && (
        <div className={vlanAdded ? "layer vlan added" : "layer vlan"}>
          <div className="ly-h"><b>802.1Q VLAN tag</b><span>{vlanAdded ? <em className="new">added here</em> : "layer 2"}</span></div>
          <div className="ly-f"><F label="VLAN ID" value={cur.vlan} prev={prev?.vlan} /></div>
        </div>
      )}

      {tunnel ? (
        <>
          <Ip p={cur} prev={prevSameShape} title="Outer IPv4" added={tunnelAdded} />
          <div className={`layer tun t-${cur.tunnel}${tunnelAdded ? " added" : ""}`}>
            <div className="ly-h">
              <b>{cur.tunnel === "esp" ? "ESP (IPsec)" : cur.tunnel === "eoip" ? "GRE (EoIP)" : cur.tunnel?.toUpperCase()}</b>
              <span>{tunnelAdded ? <em className="new">added here</em> : cur.tunnel === "esp" ? "encrypted payload ↓" : "tunnel header"}</span>
            </div>
          </div>
          <div className={cur.tunnel === "esp" ? "encap enc" : "encap"}>
            {cur.tunnel === "eoip" && (
              <div className="layer l2 inner">
                <div className="ly-h"><b>Inner Ethernet</b><span>bridged frame</span></div>
              </div>
            )}
            <Ip p={cur.inner!} prev={innerPrev as Inner | undefined} title="Inner IPv4" locked={cur.tunnel === "esp"} />
            <L4 p={cur.inner!} prev={innerPrev as Inner | undefined} locked={cur.tunnel === "esp"} />
          </div>
        </>
      ) : (
        <>
          <Ip p={cur} prev={prevSameShape} title="IPv4" />
          <L4 p={cur} prev={prevSameShape} />
        </>
      )}
      <div className="layer payload">
        <div className="ly-h"><b>Payload</b><span>application data</span></div>
      </div>
    </div>
  );
}
