import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_SHORT } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "RouterOS Sim",
    description: SITE_SHORT,
    start_url: "/",
    display: "standalone",
    background_color: "#0d1015",
    theme_color: "#e8590c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
