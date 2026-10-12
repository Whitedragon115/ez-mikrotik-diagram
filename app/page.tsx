import { readFileSync } from "node:fs";
import { join } from "node:path";
import ClientApp from "@/components/ClientApp";
import { SITE_DESCRIPTION, SITE_FEATURES, SITE_NAME, SITE_URL } from "@/lib/site";

// Structured data: tells search engines this is a free web application.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  alternateName: ["MikroTik Online Simulator", "MikroTik Firewall Debugger", "RouterOS Packet Flow Simulator"],
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  applicationCategory: "UtilitiesApplication",
  applicationSubCategory: "Network simulator",
  operatingSystem: "Any (web browser)",
  browserRequirements: "Requires JavaScript",
  isAccessibleForFree: true,
  inLanguage: "en",
  featureList: SITE_FEATURES,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

// Rendered at build time; the README is shown to visitors before they enter the simulator.
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ClientApp readme={readme} />
    </>
  );
}
