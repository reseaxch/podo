export interface HealthResponse {
  service: "podo-core"
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
  service: "podo-core"
  status: "ready" | "degraded"
  version: string
  codex: CodexRuntimeStatus
  remediation: {
    configured: boolean
  }
}

export type AutonomyMode = "observe" | "recommend" | "act_with_approval"

export interface PodoSettings {
  autonomyMode: AutonomyMode
  monitoringEnabled: boolean
  defaultSandbox: InvestigationSandbox
  turnTimeoutMs: number
}

export interface GetSettingsResponse {
  settings: PodoSettings
}

export type UpdateSettingsRequest = Partial<PodoSettings>

export interface UpdateSettingsResponse {
  settings: PodoSettings
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

export interface IncidentDiagnosisConfidence {
  value: number
  scale: "basis_points"
}

export interface ValidatedIncidentDiagnosis {
  status: "validated"
  schemaVersion: "podo.diagnosis.v1"
  summary: string
  affectedService: string
  probableRootCause: string
  confidence: IncidentDiagnosisConfidence
  evidenceIds: string[]
  recommendedAction: string
  safeToAttemptFix: boolean
}

export type IncidentDiagnosisErrorCode =
  | "invalid_output"
  | "affected_service_mismatch"
  | "investigation_failed"
  | "investigation_cancelled"

export interface FailedIncidentDiagnosis {
  status: "failed"
  error: {
    code: IncidentDiagnosisErrorCode
    message: string
  }
}

export type IncidentDiagnosis = ValidatedIncidentDiagnosis | FailedIncidentDiagnosis

export interface DetectedIncident {
  id: string
  status: "detected"
  detector: "cache_growth"
  affectedService: string
  deploymentId: string
  createdAt: string
  updatedAt: string
  evidence: IncidentEvidence[]
  investigation?: IncidentInvestigationLink
  diagnosis?: IncidentDiagnosis
}

export interface IncidentInvestigationLink {
  id: string
  status: InvestigationStatus
  startedAt: string
  updatedAt: string
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

export const PODO_CAUSAL_PATH_SCHEMA_VERSION = "podo.causal-path.v1" as const

export interface IncidentCausalPathFileNode {
  id: string
  kind: "file"
  externalId: string
  label: string
  location?: CodeGraphSourceLocation
}

export interface IncidentCausalPathFunctionNode {
  id: string
  kind: "function"
  externalId: string
  label: string
  location?: CodeGraphSourceLocation
}

export interface IncidentCausalPath {
  schemaVersion: typeof PODO_CAUSAL_PATH_SCHEMA_VERSION
  id: string
  incident: { id: string }
  evidence: { id: string }
  telemetryEvent: { id: string; occurredAt: string }
  container: { id: string }
  deployment: { id: string }
  commit: { id: string; sha: string }
  file: IncidentCausalPathFileNode
  function: IncidentCausalPathFunctionNode
}

export interface GetIncidentCausalPathResponse {
  causalPath: IncidentCausalPath
}

export type IncidentRemediationStatus =
  | "pending_approval"
  | "running"
  | "completed"
  | "denied"
  | "failed"

export interface IncidentRemediationApproval {
  id: string
  status: "pending" | "approved" | "denied"
}

export interface IncidentRemediationArtifact {
  provenance: {
    baseRef: string
    baseCommit: string
    resultTreeOid: string
  }
  evidenceIds: string[]
  patch: {
    summary: string
    changedFiles: string[]
    unifiedDiff: string
    sha256: string
  }
  regression: {
    test: string
    prePatch: "failed"
    postPatch: "passed"
  }
  validation: {
    status: "passed"
    checks: string[]
  }
  pullRequestPreview: {
    id: string
    title: string
    body: string
    baseBranch: string
    headBranch: string
  }
}

export interface IncidentRemediation {
  id: string
  incidentId: string
  status: IncidentRemediationStatus
  target: "isolated_checkout"
  approval: IncidentRemediationApproval
  createdAt: string
  updatedAt: string
  artifact?: IncidentRemediationArtifact
  error?: {
    code: "execution_failed" | "invalid_executor_result" | "verification_failed" | "policy_denied"
    message: string
  }
}

export interface StartIncidentRemediationResponse {
  remediation: IncidentRemediation
}

export interface GetIncidentRemediationResponse {
  remediation: IncidentRemediation
}

export interface IncidentRemediationDecisionRequest {
  decision: "approve" | "deny"
}

export interface IncidentRemediationDecisionResponse {
  remediation: IncidentRemediation
}

interface IncidentRemediationAuditEventBase {
  sequence: number
  occurredAt: string
  incidentId: string
  remediationId: string
}

export type IncidentRemediationAuditEvent =
  | IncidentRemediationAuditEventBase & {
    kind: "remediation.requested"
  }
  | IncidentRemediationAuditEventBase & {
    kind: "remediation.approval_decided"
    approvalId: string
    decision: "approve" | "deny"
  }
  | IncidentRemediationAuditEventBase & {
    kind: "remediation.execution_started"
  }
  | IncidentRemediationAuditEventBase & {
    kind: "remediation.verification_failed"
    code: NonNullable<IncidentRemediation["error"]>["code"]
  }
  | IncidentRemediationAuditEventBase & {
    kind: "remediation.verification_succeeded"
    artifactId: string
  }
  | IncidentRemediationAuditEventBase & {
    kind: "delivery.requested"
    deliveryId: string
    artifactId: string
  }
  | IncidentRemediationAuditEventBase & {
    kind: "delivery.approval_decided"
    deliveryId: string
    approvalId: string
    decision: "approve" | "deny"
  }
  | IncidentRemediationAuditEventBase & {
    kind: "delivery.started"
    deliveryId: string
    artifactId: string
  }
  | IncidentRemediationAuditEventBase & {
    kind: "delivery.failed"
    deliveryId: string
    code: IncidentDeliveryErrorCode
  }
  | IncidentRemediationAuditEventBase & {
    kind: "delivery.succeeded"
    deliveryId: string
    artifactId: string
    pullRequestUrl: string
  }

export interface GetIncidentRemediationAuditResponse {
  events: IncidentRemediationAuditEvent[]
}

interface IncidentAuditEventBase {
  sequence: number
  occurredAt: string
  incidentId: string
}

export type IncidentAuditEvent =
  | IncidentAuditEventBase & { kind: "investigation.requested" }
  | IncidentAuditEventBase & { kind: "investigation.started"; investigationId: string }
  | IncidentAuditEventBase & {
    kind: "investigation.approval_denied"
    investigationId: string
    approvalKind: InvestigationApproval["kind"]
  }
  | IncidentAuditEventBase & { kind: "investigation.completed"; investigationId: string }
  | IncidentAuditEventBase & { kind: "investigation.failed"; investigationId: string }
  | IncidentAuditEventBase & { kind: "investigation.cancelled"; investigationId: string }
  | IncidentAuditEventBase & {
    kind: "investigation.diagnosis_validated"
    investigationId: string
    evidenceIds: string[]
  }
  | IncidentAuditEventBase & {
    kind: "investigation.diagnosis_rejected"
    investigationId: string
    code: IncidentDiagnosisErrorCode
  }
  | IncidentAuditEventBase & { kind: "issue.requested"; issueDeliveryId: string; reason: IncidentIssueFallbackReason }
  | IncidentAuditEventBase & { kind: "issue.succeeded"; issueDeliveryId: string; issueUrl: string }
  | IncidentAuditEventBase & { kind: "issue.failed"; issueDeliveryId: string; code: IncidentIssueErrorCode }

export interface GetIncidentAuditResponse {
  events: IncidentAuditEvent[]
}

export type IncidentIssueFallbackReason = "remediation_not_safe" | "remediation_denied" | "remediation_failed"
export type IncidentIssueErrorCode = "policy_denied" | "fallback_not_available" | "confidential_content" | "delivery_unavailable" | "delivery_failed" | "invalid_delivery_result"

export interface IncidentIssueDelivery {
  id: string
  incidentId: string
  reason: IncidentIssueFallbackReason
  status: "creating" | "created" | "failed"
  createdAt: string
  updatedAt: string
  issue?: {
    provider: "github"
    repository: string
    number: number
    url: string
    state: "open"
    providerStatus: "created" | "existing"
    draftId: string
    idempotencyKey: string
    contentSha256: string
  }
  error?: { code: IncidentIssueErrorCode; message: string }
}

export interface StartIncidentIssueResponse {
  issueDelivery: IncidentIssueDelivery
}

export interface GetIncidentIssueResponse {
  issueDelivery: IncidentIssueDelivery
}

export type IncidentDeliveryErrorCode =
  | "policy_denied"
  | "artifact_changed"
  | "delivery_failed"
  | "invalid_delivery_result"

export interface IncidentDelivery {
  id: string
  incidentId: string
  remediationId: string
  artifactId: string
  status: "pending_approval" | "delivering" | "delivered" | "denied" | "failed"
  approval: {
    id: string
    status: "pending" | "approved" | "denied"
  }
  createdAt: string
  updatedAt: string
  pullRequest?: {
    provider: "github"
    repository: string
    number: number
    url: string
    baseCommit: string
    baseBranch: string
    headBranch: string
    artifactId: string
  }
  error?: {
    code: IncidentDeliveryErrorCode
    message: string
  }
}

export interface StartIncidentDeliveryResponse {
  delivery: IncidentDelivery
}

export interface GetIncidentDeliveryResponse {
  delivery: IncidentDelivery
}

export interface IncidentDeliveryDecisionRequest {
  decision: "approve" | "deny"
}

export interface IncidentDeliveryDecisionResponse {
  delivery: IncidentDelivery
}

export interface StartIncidentInvestigationRequest {
  cwd: string
}

export interface StartIncidentInvestigationResponse {
  incident: DetectedIncident
  investigation: Investigation
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

export const PODO_CODE_GRAPH_SCHEMA_VERSION = "podo.code-graph.v1" as const

export type CodeGraphNodeKind =
  | "repository"
  | "service"
  | "file"
  | "function"
  | "endpoint"

export type CodeGraphLinkType =
  | "CONTAINS"
  | "OWNS"
  | "IMPORTS"
  | "CALLS"
  | "EXPOSES"

export type CodeGraphProvenance = "extracted" | "inferred" | "ambiguous"

export interface CodeGraphSourceLocation {
  path: string
  line: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface NormalizedCodeGraphNode {
  id: string
  externalId: string
  kind: CodeGraphNodeKind
  label: string
  provenance: CodeGraphProvenance
  location?: CodeGraphSourceLocation
}

export interface NormalizedCodeGraphLink {
  id: string
  externalId: string
  type: CodeGraphLinkType
  fromNodeId: string
  toNodeId: string
  fromExternalId: string
  toExternalId: string
  provenance: CodeGraphProvenance
  location?: CodeGraphSourceLocation
}

export interface NormalizedCodeGraphSnapshot {
  id: string
  schemaVersion: typeof PODO_CODE_GRAPH_SCHEMA_VERSION
  source: {
    provider: string
    graphId: string
    schemaVersion: string
  }
  nodes: NormalizedCodeGraphNode[]
  links: NormalizedCodeGraphLink[]
}

export interface ApiErrorResponse {
  error: string
  message?: string
}
