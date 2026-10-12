import type { Shape } from "@/lib/flow";

interface Props {
  s: Shape;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The outline for one diagram block; colors come from --c / --cf on the parent <g>. */
export default function FlowShape({ s, x, y, w, h }: Props) {
  const l = x - w / 2, r = x + w / 2, t = y - h / 2, b = y + h / 2;
  switch (s) {
    case "decision":
      return <polygon className="shape" points={`${x},${t} ${r},${y} ${x},${b} ${l},${y}`} />;
    case "para": {
      const o = 9;
      return <polygon className="shape" points={`${l + o},${t} ${r},${t} ${r - o},${b} ${l},${b}`} />;
    }
    case "hex": {
      const k = 13;
      return <polygon className="shape" points={`${l + k},${t} ${r - k},${t} ${r},${y} ${r - k},${b} ${l + k},${b} ${l},${y}`} />;
    }
    case "pill":
    case "portal":
      return <rect className="shape" x={l} y={t} width={w} height={h} rx={h / 2} />;
    case "chain":
      return (
        <>
          <rect className="shape" x={l} y={t} width={w} height={h} rx={3} />
          <line className="bar" x1={l + 7} y1={t} x2={l + 7} y2={b} />
          <line className="bar" x1={r - 7} y1={t} x2={r - 7} y2={b} />
        </>
      );
    default:
      return <rect className="shape" x={l} y={t} width={w} height={h} rx={6} />;
  }
}
