import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  devIndicators: false,
  webpack: (config, { dev }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

module.exports = nextConfig;
