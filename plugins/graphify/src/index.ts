import type { PluginManifest } from "@podo/plugin-sdk"

export * from "./graph"
export * from "./networkx-v1"

export const graphifyPluginManifest = {
  id: "podo.graphify",
  displayName: "Graphify code graph",
  version: "0.0.0",
  capabilities: ["code_graph"],
} as const satisfies PluginManifest
