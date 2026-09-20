import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stops `next dev` from auto-generating extra markdown files in this folder on startup.
  agentRules: false,
  // Hides the round "N" button that `next dev` draws in the bottom-left corner of every page.
  devIndicators: false,
};

export default nextConfig;
