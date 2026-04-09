import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Penzi Sachen Zähler",
    short_name: "Penzi Zähler",
    description: "Schnelle mobile Inventory-App für Penzi Sachen.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5efe6",
    theme_color: "#6f4e37",
    icons: [
      {
        src: "/icon",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}

