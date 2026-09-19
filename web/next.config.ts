import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stops `next dev` from auto-generating extra markdown files in this folder on startup.
  agentRules: false,
};

export default nextConfig;
