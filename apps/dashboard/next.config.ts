import type { NextConfig } from "next"
import { resolve } from "node:path"

const workspaceRoot = resolve(process.cwd(), "../..")

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@rootline/contracts", "@rootline/client"],
  turbopack: {
    root: workspaceRoot,
  },
}

export default nextConfig
