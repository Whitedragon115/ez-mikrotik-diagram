import type { Metadata } from "next";
import PreviewClient from "@/components/preview/PreviewClient";
import "../preview.css";

export const metadata: Metadata = {
  title: "Config Preview",
  description: "Router-style read-only view of the simulated RouterOS configuration.",
  // shows the visitor's own saved setup, so it isn't a page to index
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return <PreviewClient />;
}
