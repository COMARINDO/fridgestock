import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Repo contains multiple lockfiles; ensure correct root.
    root: __dirname,
  },
};

export default nextConfig;
