import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fridge Stock",
    short_name: "Fridge",
    description: "Schnelle Bestandsverwaltung für Getränke in mehreren Locations.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f0e",
    theme_color: "#0b0f0e",
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

