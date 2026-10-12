"use client";

import dynamic from "next/dynamic";

// Reads the saved simulator config from localStorage, so it renders client-side only.
const PreviewApp = dynamic(() => import("./PreviewApp"), {
  ssr: false,
  loading: () => <div className="wb-loading">Loading configuration…</div>,
});

export default function PreviewClient() {
  return <PreviewApp />;
}
