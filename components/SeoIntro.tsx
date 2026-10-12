import { SITE_FEATURES } from "@/lib/site";

/**
 * Server-rendered intro shown while the simulator loads. It's what visitors see for a moment, and what
 * search engines and link previews read, since the simulator itself only renders in the browser.
 */
export default function SeoIntro() {
  return (
    <main className="app loading seo-intro">
      <div className="seo-card">
        <div className="seo-logo" aria-hidden>⇄</div>
        <h1>MikroTik Online Simulator &amp; Firewall Debugger</h1>
        <p className="seo-lead">
          A free, unofficial RouterOS packet flow simulator. Build or import a MikroTik config, send a test packet,
          and step through prerouting, NAT, mangle, filter, routing and postrouting to see exactly which rule made
          each decision. It runs in your browser, with nothing to install and no login required.
        </p>
        <ul>
          {SITE_FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="seo-loading" role="status">Loading the simulator…</p>
        <noscript>
          <p>The simulator needs JavaScript. Please enable it to use the interactive diagram.</p>
        </noscript>
        <p className="seo-note">Not affiliated with MikroTik. MikroTik, RouterOS and WinBox are trademarks of their respective owner.</p>
      </div>
    </main>
  );
}
