export type PluginCapability =
  | "code_graph"
  | "telemetry_source"
  | "repository_read"
  | "issue_write"
  | "pull_request_write"

export interface PluginManifest {
  id: string
  displayName: string
  version: string
  capabilities: readonly PluginCapability[]
}

export interface PluginContext {
  emitAuditEvent(event: {
    type: string
    pluginId: string
    status: "started" | "completed" | "failed"
    detail?: Record<string, unknown>
  }): void
}

export interface PodoPlugin {
  manifest: PluginManifest
  setup(context: PluginContext): Promise<void>
  dispose?(): Promise<void>
}
