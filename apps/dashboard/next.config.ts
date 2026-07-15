import type { NextConfig } from "next"
import { resolve } from "node:path"

const workspaceRoot = resolve(process.cwd(), "../..")

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@podo/contracts", "@podo/client"],
  turbopack: {
    root: workspaceRoot,
  },
}

export default nextConfig
