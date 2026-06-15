import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the tracing root so a stray lockfile in a parent folder doesn't
  // confuse workspace detection.
  outputFileTracingRoot: path.join(__dirname),
  // Server-only packages that must not be bundled into route chunks.
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
};

export default nextConfig;
