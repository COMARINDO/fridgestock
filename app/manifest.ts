import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bstand",
    short_name: "Bstand",
    description: "Schnelle mobile Inventory-App.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff4ea",
    theme_color: "#000000",
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

