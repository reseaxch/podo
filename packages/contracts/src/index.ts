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

export type AutonomyMode = "observe" | "recommend" | "act_with_approval"

export interface RootlineSettings {
  autonomyMode: AutonomyMode
  monitoringEnabled: boolean
  defaultSandbox: InvestigationSandbox
  turnTimeoutMs: number
}

export interface GetSettingsResponse {
  settings: RootlineSettings
}

export type UpdateSettingsRequest = Partial<RootlineSettings>

export interface UpdateSettingsResponse {
  settings: RootlineSettings
}

export type TelemetryKind = "log" | "trace" | "metric"
export type TelemetrySeverity = "debug" | "info" | "warn" | "error" | "critical"

export interface TelemetryMetricInput {
  name: string
  value: number
  unit?: string
}

export interface TelemetryEventInput {
  timestamp: string
  kind: TelemetryKind
  service: string
  severity: TelemetrySeverity
  message: string
  deploymentId?: string
  commitId?: string
  traceId?: string
  containerId?: string
  metric?: TelemetryMetricInput
}

export interface RejectedTelemetryEvent {
  index: number
  reason: string
}

export interface TelemetryIngestionResult {
  accepted: number
  duplicates: number
  rejected: RejectedTelemetryEvent[]
}

export interface IncidentEvidence {
  id: string
  sourceEventId: string
  sourceType: TelemetryKind
  observedAt: string
  service: string
  deploymentId: string
}

export interface DetectedIncident {
  id: string
  status: "detected"
  detector: "cache_growth"
  affectedService: string
  deploymentId: string
  createdAt: string
  updatedAt: string
  evidence: IncidentEvidence[]
}

export type IncidentReaction =
  | { action: "open_incident"; detector: "cache_growth"; service: string; deploymentId: string; reason: string }
  | { action: "hold_for_more_evidence"; detector: "cache_growth"; service: string; deploymentId: string; reason: string }
  | { action: "ignore_healthy"; detector: "cache_growth"; reason: string }

export interface IngestTelemetryRequest {
  events: TelemetryEventInput[]
}

export interface IngestTelemetryResponse {
  ingestion: TelemetryIngestionResult
  reaction: IncidentReaction
  incident: DetectedIncident | null
}

export interface ListIncidentsResponse {
  incidents: DetectedIncident[]
}

export interface GetIncidentResponse {
  incident: DetectedIncident
}

export type InvestigationStatus =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "cancelled"
  | "failed"

export type InvestigationSandbox = "read-only" | "workspace-write"

export interface StartInvestigationRequest {
  prompt: string
  cwd: string
  sandbox: InvestigationSandbox
}

export interface InvestigationApproval {
  id: string
  kind: "command" | "file_change" | "permissions" | "user_input"
  status: "pending" | "approved" | "denied"
  reason?: string
  command?: string
  questions?: Array<{
    id: string
    header: string
    question: string
    options: Array<{ label: string; description: string }> | null
  }>
}

export interface Investigation {
  id: string
  status: InvestigationStatus
  cwd: string
  sandbox: InvestigationSandbox
  createdAt: string
  updatedAt: string
  lastSequence: number
  pendingApproval: InvestigationApproval | null
  error?: string
}

export interface StartInvestigationResponse {
  investigation: Investigation
}

export interface GetInvestigationResponse {
  investigation: Investigation
}

export interface CancelInvestigationResponse {
  investigation: Investigation
}

export interface ApprovalDecisionRequest {
  decision: "approve" | "deny"
  answers?: Record<string, string[]>
}

export interface ApprovalDecisionResponse {
  investigation: Investigation
  approval: InvestigationApproval
}

type InvestigationEventData =
  | { kind: "investigation.started"; payload: { status: "starting" } }
  | { kind: "investigation.running"; payload: { status: "running" } }
  | { kind: "output.delta"; payload: { text: string } }
  | { kind: "approval.requested"; payload: { approval: InvestigationApproval } }
  | { kind: "approval.resolved"; payload: { approval: InvestigationApproval } }
  | { kind: "investigation.completed"; payload: { status: "completed" } }
  | { kind: "investigation.cancelled"; payload: { status: "cancelled" } }
  | { kind: "investigation.failed"; payload: { status: "failed"; error: string } }

export type InvestigationEvent = {
  investigationId: string
  sequence: number
  timestamp: string
} & InvestigationEventData

export interface ApiErrorResponse {
  error: string
  message?: string
}
