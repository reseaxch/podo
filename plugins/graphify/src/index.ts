import type { PluginManifest } from "@rootline/plugin-sdk"

export const graphifyPluginManifest = {
  id: "rootline.graphify",
  displayName: "Graphify code graph",
  version: "0.0.0",
  capabilities: ["code_graph"],
} as const satisfies PluginManifest
