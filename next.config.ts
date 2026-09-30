import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Ensure Prisma query engine and sharp native binaries are included in trace
  outputFileTracingIncludes: {
    "/*": [
      "src/generated/prisma/**/*",
      "node_modules/sharp/**/*",
    ],
  },
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/serve-uploads/:path*",
      },
    ];
  },
};

export default nextConfig;
