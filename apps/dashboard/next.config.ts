import type { NextConfig } from "next"
import { PHASE_DEVELOPMENT_SERVER } from "next/constants"
import { resolve } from "node:path"

const workspaceRoot = resolve(process.cwd(), "../..")

export default function nextConfig(phase: string): NextConfig {
  return {
    // Keep the long-running preview isolated from production build artifacts.
    // Running `next build` while `next dev` is open must not invalidate HMR.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    outputFileTracingRoot: workspaceRoot,
    transpilePackages: ["@podo/contracts", "@podo/client"],
    turbopack: {
      root: workspaceRoot,
    },
  }
}
