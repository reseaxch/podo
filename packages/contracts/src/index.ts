export interface HealthResponse {
  service: "rootline-core"
  status: "ok"
  version: string
}

export interface CodexRuntimeStatus {
  available: boolean
  binary: string
  transport: "stdio"
  version: string | null
  error?: string
}

export interface SystemStatusResponse {
  service: "rootline-core"
  status: "ready" | "degraded"
  version: string
  codex: CodexRuntimeStatus
}
