"use client";

import dynamic from "next/dynamic";
import ReadmeGate from "./ReadmeGate";
import SeoIntro from "./SeoIntro";

// The simulator reads saved config from localStorage and is purely interactive, so it renders client-side only.
// Until it loads, the server-rendered intro is shown (and is what crawlers index).
const Simulator = dynamic(() => import("./Simulator"), {
  ssr: false,
  loading: () => <SeoIntro />,
});

export default function ClientApp({ readme }: { readme: string }) {
  return (
    <ReadmeGate markdown={readme}>
      <Simulator />
    </ReadmeGate>
  );
}
