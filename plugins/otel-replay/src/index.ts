import type { PluginManifest } from "@rootline/plugin-sdk"

export const otelReplayPluginManifest = {
  id: "rootline.otel-replay",
  displayName: "OpenTelemetry replay",
  version: "0.0.0",
  capabilities: ["telemetry_source"],
} as const satisfies PluginManifest
