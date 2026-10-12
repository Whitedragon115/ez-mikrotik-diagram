"use client";

import { useEffect, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SeoIntro from "./SeoIntro";

// Bump the version to show the README again to everyone (e.g. after the warning changes).
const ACK_KEY = "readme-ack-v1";

/**
 * Shows the README before the simulator, with the AI-awareness notice highlighted.
 * Server output (and crawlers) get the SeoIntro; the gate only appears in the browser, until it is acknowledged.
 */
export default function ReadmeGate({ markdown, children }: { markdown: string; children: ReactNode }) {
  const [ack, setAck] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      setAck(localStorage.getItem(ACK_KEY) === "1");
    } catch {
      setAck(false);
    }
  }, []);

  if (ack === null) return <SeoIntro />;
  if (ack) return <>{children}</>;

  const enter = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {
      /* storage blocked: the notice will simply show again next visit */
    }
    setAck(true);
  };

  return (
    <div className="readme-gate" role="dialog" aria-modal="true" aria-label="README">
      <div className="readme-card">
        <div className="readme-head">
          <div className="eyebrow" style={{ color: "var(--accent)" }}>Before you start</div>
          <h2>Please read this first</h2>
        </div>
        <div className="readme-body">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              // the README opens with the AI-awareness block quote: render it as a loud warning
              blockquote: ({ children: c }) => <aside className="ai-callout" role="alert">{c}</aside>,
              a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer">{c}</a>,
            }}
          >
            {markdown}
          </Markdown>
        </div>
        <div className="readme-foot">
          <label>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            I understand this is unreviewed AI-generated code and I won&apos;t blindly trust its results
          </label>
          <span className="sp" />
          <button className="btn primary" disabled={!checked} onClick={enter}>Enter the simulator</button>
        </div>
      </div>
    </div>
  );
}
