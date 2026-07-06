import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ecco/core é consumido como código-fonte TS (imports com extensão .ts),
  // então o Next transpila o pacote em vez de exigir build separado.
  transpilePackages: ["@ecco/core"],
};

export default nextConfig;
