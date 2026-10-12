// Social share image (1200×630), generated at build time.
import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const alt = `${SITE_NAME}: free online MikroTik RouterOS simulator and firewall debugger`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STEPS = ["PREROUTING", "Routing decision", "FORWARD", "POSTROUTING", "out ether1"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#0d1015",
          backgroundImage: "radial-gradient(circle, #2c333e 1.6px, transparent 1.8px)",
          backgroundSize: "28px 28px",
          color: "#e6e9ee",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#e8590c" />
            <path d="M14 23h30M37 15l8 8-8 8M50 41H20M27 33l-8 8 8 8" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 30, color: "#9aa4b2" }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>MikroTik Online Simulator</div>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1, color: "#ff8a3d" }}>& Firewall Debugger</div>
          <div style={{ fontSize: 30, color: "#9aa4b2" }}>See which rule decided, step by step · Free · No login</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  padding: "12px 18px",
                  borderRadius: 10,
                  border: `2px solid ${i === 2 ? "#ff8a3d" : "#3fd1a2"}`,
                  background: i === 2 ? "rgba(255,138,61,.15)" : "rgba(63,209,162,.08)",
                  fontSize: 22,
                  fontWeight: 700,
                }}
              >
                {s}
              </div>
              {i < STEPS.length - 1 && <div style={{ fontSize: 26, color: "#ff8a3d" }}>→</div>}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
