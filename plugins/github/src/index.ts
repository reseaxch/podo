import type { PluginManifest } from "@podo/plugin-sdk"

export const githubPluginManifest = {
  id: "podo.github",
  displayName: "GitHub",
  version: "0.0.0",
  capabilities: ["repository_read", "issue_write", "pull_request_write"],
} as const satisfies PluginManifest
