import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["integrating-centers-browsing-she.trycloudflare.com"],
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
