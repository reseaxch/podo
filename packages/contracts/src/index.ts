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

export interface NormalizedTelemetryEvent extends TelemetryEventInput {
  id: string
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

export interface IncidentEvidenceRecord {
  evidence: IncidentEvidence
  event: NormalizedTelemetryEvent
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

export type BuildIncidentEvidenceSourceType =
  | "github_actions_workflow_run"
  | "github_actions_job"
  | "github_actions_step"

export interface BuildIncidentEvidence {
  id: string
  sourceId: string
  sourceType: BuildIncidentEvidenceSourceType
  observedAt: string
  repository: string
  runId: number
  runAttempt: number
  headSha: string
  summary: string
}

export interface GitHubActionsWorkflowRunEvidence extends BuildIncidentEvidence {
  sourceType: "github_actions_workflow_run"
  workflowId: number
  workflowName: string
  status: "completed"
  conclusion: "failure"
  url: string
}

export interface GitHubActionsJobEvidence extends BuildIncidentEvidence {
  sourceType: "github_actions_job"
  jobId: number
  jobName: string
  status: "completed"
  conclusion: BuildCiConclusion
  url?: string
}

export interface GitHubActionsStepEvidence extends BuildIncidentEvidence {
  sourceType: "github_actions_step"
  jobId: number
  jobName: string
  stepNumber: number
  stepName: string
  status: BuildCiRunStatus
  conclusion: BuildCiConclusion | null
}

export type GitHubActionsBuildIncidentEvidence =
  | GitHubActionsWorkflowRunEvidence
  | GitHubActionsJobEvidence
  | GitHubActionsStepEvidence

export interface GitHubActionsWorkflowRunSignal {
  provider: "github"
  event: "workflow_run"
  action: "completed"
  deliveryId: string
  repository: {
    owner: string
    name: string
  }
  run: {
    id: number
    attempt: number
    headSha: string
  }
}

export type BuildCiRunStatus =
  | "requested"
  | "queued"
  | "pending"
  | "waiting"
  | "in_progress"
  | "completed"

export type BuildCiConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "success"
  | "timed_out"

export interface BuildWorkflowRun {
  id: number
  workflowId: number
  workflowName: string
  workflowPath: string
  runNumber: number
  attempt: number
  event: string
  headBranch: string | null
  headSha: string
  status: BuildCiRunStatus
  conclusion: BuildCiConclusion | null
  createdAt: string
  updatedAt: string
  url: string
}

interface VerifiedBuildCiResultBase {
  provider: "github_actions"
  repository: string
  workflowId: number
  runId: number
  runAttempt: number
  headSha: string
  status: "completed"
  conclusion: "success"
  url: string
  verifiedAt: string
}

export type VerifiedBuildCiResult =
  | VerifiedBuildCiResultBase & { mode: "retry"; artifactId?: never }
  | VerifiedBuildCiResultBase & { mode: "remediation"; artifactId: string }

export type BuildIncidentRetryErrorCode =
  | "policy_denied"
  | "retry_unavailable"
  | "retry_failed"
  | "invalid_retry_result"
  | "ci_result_mismatch"
  | "ci_failed"
  | "verification_timeout"

export interface BuildIncidentRetry {
  id: string
  status: "pending_approval" | "dispatching" | "awaiting_ci_result" | "verified" | "denied" | "failed"
  approval: {
    id: string
    status: "pending" | "approved" | "denied"
  }
  sourceRun: {
    id: number
    attempt: number
    headSha: string
  }
  createdAt: string
  updatedAt: string
  result?: VerifiedBuildCiResult & { mode: "retry" }
  error?: { code: BuildIncidentRetryErrorCode; message: string }
}

export type BuildRemediationVerificationErrorCode =
  | "remediation_not_verified"
  | "delivery_not_verified"
  | "ci_result_mismatch"
  | "ci_failed"
  | "verification_timeout"

export interface BuildRemediationVerification {
  id: string
  status: "awaiting_ci_result" | "verified" | "failed"
  repository: string
  workflowId: number
  remediationId: string
  artifactId: string
  resultTreeOid: string
  headBranch: string
  headSha: string
  createdAt: string
  updatedAt: string
  result?: VerifiedBuildCiResult & { mode: "remediation"; artifactId: string }
  error?: { code: BuildRemediationVerificationErrorCode; message: string }
}

export type BuildIncidentStatus =
  | "investigating"
  | "awaiting_action"
  | "retry_pending_approval"
  | "retrying"
  | "awaiting_ci_result"
  | "remediating"
  | "verified"
  | "denied"
  | "failed"

export interface BuildIncident {
  id: string
  status: BuildIncidentStatus
  detector: "github_actions_failure"
  provider: "github_actions"
  repository: string
  affectedService: string
  workflow: {
    id: number
    name: string
    path: string
  }
  sourceRun: BuildWorkflowRun & { status: "completed"; conclusion: "failure" }
  evidence: GitHubActionsBuildIncidentEvidence[]
  createdAt: string
  updatedAt: string
  investigation?: IncidentInvestigationLink
  diagnosis?: IncidentDiagnosis
  retry?: BuildIncidentRetry
  remediationVerification?: BuildRemediationVerification
  ciResult?: VerifiedBuildCiResult
}

export interface ListBuildIncidentsResponse {
  incidents: BuildIncident[]
}

export interface GetBuildIncidentResponse {
  incident: BuildIncident
}

export interface IngestBuildIncidentResponse {
  created: boolean
  incident: BuildIncident
}

export interface StartBuildIncidentRetryResponse {
  incident: BuildIncident
  retry: BuildIncidentRetry
}

export interface GetBuildIncidentRetryResponse {
  incident: BuildIncident
  retry: BuildIncidentRetry
}

export interface BuildIncidentRetryDecisionRequest {
  decision: "approve" | "deny"
}

export interface BuildIncidentRetryDecisionResponse {
  incident: BuildIncident
  retry: BuildIncidentRetry
}

export interface StartBuildRemediationVerificationResponse {
  incident: BuildIncident
  verification: BuildRemediationVerification
}

export interface GetBuildRemediationVerificationResponse {
  incident: BuildIncident
  verification: BuildRemediationVerification
}

interface BuildIncidentAuditEventBase {
  sequence: number
  occurredAt: string
  incidentId: string
}

export type BuildIncidentAuditEvent =
  | BuildIncidentAuditEventBase & {
    kind: "build.signal_received"
    deliveryId: string
    runId: number
    runAttempt: number
    headSha: string
  }
  | BuildIncidentAuditEventBase & { kind: "build.evidence_captured"; evidenceIds: string[] }
  | BuildIncidentAuditEventBase & { kind: "build.incident_created" }
  | BuildIncidentAuditEventBase & { kind: "investigation.requested" }
  | BuildIncidentAuditEventBase & { kind: "investigation.started"; investigationId: string }
  | BuildIncidentAuditEventBase & {
    kind: "investigation.tool_step"
    investigationId: string
    stepId: string
    tool: InvestigationToolKind
    status: InvestigationToolStep["status"]
    inputSummary: string
    outputSummary?: string
  }
  | BuildIncidentAuditEventBase & {
    kind: "investigation.approval_denied"
    investigationId: string
    approvalKind: InvestigationApproval["kind"]
  }
  | BuildIncidentAuditEventBase & { kind: "investigation.completed"; investigationId: string }
  | BuildIncidentAuditEventBase & { kind: "investigation.failed"; investigationId: string }
  | BuildIncidentAuditEventBase & { kind: "investigation.cancelled"; investigationId: string }
  | BuildIncidentAuditEventBase & {
    kind: "investigation.diagnosis_validated"
    investigationId: string
    evidenceIds: string[]
  }
  | BuildIncidentAuditEventBase & {
    kind: "investigation.diagnosis_rejected"
    investigationId: string
    code: IncidentDiagnosisErrorCode
  }
  | BuildIncidentAuditEventBase & { kind: "build.retry_requested"; retryId: string; approvalId: string }
  | BuildIncidentAuditEventBase & {
    kind: "build.retry_approval_decided"
    retryId: string
    approvalId: string
    decision: "approve" | "deny"
    decidedBy: string
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.retry_dispatch_attempted"
    retryId: string
    approvalId: string
    approvedBy: string
    approvedAt: string
    repository: string
    idempotencyKey: string
    runId: number
    headSha: string
    previousAttempt: number
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.retry_dispatched"
    retryId: string
    approvalId: string
    approvedBy: string
    approvedAt: string
    providerStatus: "accepted" | "existing"
    repository: string
    idempotencyKey: string
    runId: number
    headSha: string
    previousAttempt: number
    expectedRunAttempt: number
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.retry_ci_result_observed"
    retryId: string
    runId: number
    runAttempt: number
    headSha: string
    status: BuildCiRunStatus
    conclusion: BuildCiConclusion | null
  }
  | BuildIncidentAuditEventBase & { kind: "build.retry_verified"; retryId: string; runId: number; runAttempt: number }
  | BuildIncidentAuditEventBase & { kind: "build.retry_failed"; retryId: string; code: BuildIncidentRetryErrorCode }
  | BuildIncidentAuditEventBase & { kind: "build.remediation_requested"; remediationId: string }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_approval_decided"
    remediationId: string
    approvalId: string
    decision: "approve" | "deny"
    decidedBy: string
  }
  | BuildIncidentAuditEventBase & { kind: "build.remediation_tested"; remediationId: string; artifactId: string }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_failed"
    remediationId: string
    code: NonNullable<IncidentRemediation["error"]>["code"]
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.delivery_requested"
    deliveryId: string
    remediationId: string
    artifactId: string
    approvalId: string
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.delivery_approval_decided"
    deliveryId: string
    approvalId: string
    decision: "approve" | "deny"
    decidedBy: string
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.delivery_failed"
    deliveryId: string
    code: IncidentDeliveryErrorCode
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_delivered"
    deliveryId: string
    remediationId: string
    artifactId: string
    approvalId: string
    approvedBy: string
    approvedAt: string
    provider: "github"
    repository: string
    pullRequestNumber: number
    pullRequestUrl: string
    providerStatus: "created" | "existing"
    idempotencyKey: string
    baseCommit: string
    baseBranch: string
    headBranch: string
    headSha: string
    resultTreeOid: string
    patchSha256: string
    validationChecks: string[]
    evidenceIds: string[]
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_ci_verification_started"
    verificationId: string
    remediationId: string
    artifactId: string
    resultTreeOid: string
    headBranch: string
    headSha: string
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_ci_result_observed"
    verificationId: string
    runId: number
    runAttempt: number
    headSha: string
    status: BuildCiRunStatus
    conclusion: BuildCiConclusion | null
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_verified"
    verificationId: string
    remediationId: string
    artifactId: string
    runId: number
    runAttempt: number
    headSha: string
  }
  | BuildIncidentAuditEventBase & {
    kind: "build.remediation_ci_failed"
    verificationId: string
    code: BuildRemediationVerificationErrorCode
  }

export interface GetBuildIncidentAuditResponse {
  events: BuildIncidentAuditEvent[]
  retention: IncidentAuditRetention
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

export interface GetIncidentEvidenceResponse {
  records: IncidentEvidenceRecord[]
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
    kind: "investigation.tool_step"
    investigationId: string
    stepId: string
    tool: InvestigationToolKind
    status: InvestigationToolStep["status"]
    inputSummary: string
    outputSummary?: string
  }
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
  retention: IncidentAuditRetention
}

export interface IncidentAuditRetention {
  truncatedToolSteps: number
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
    headSha?: string
    artifactId: string
    proof?: {
      providerStatus: "created" | "existing"
      idempotencyKey: string
      resultTreeOid: string
      patchSha256: string
      validationChecks: string[]
      evidenceIds: string[]
      authorization: {
        approvalId: string
        approvedBy: string
        approvedAt: string
      }
    }
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

export type InvestigationToolKind =
  | "command"
  | "file_change"
  | "mcp"
  | "dynamic"
  | "collaboration"
  | "web_search"
  | "image_view"
  | "sleep"
  | "image_generation"

export interface InvestigationToolStep {
  id: string
  tool: InvestigationToolKind
  status: "started" | "completed" | "failed"
  inputSummary: string
  outputSummary?: string
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
  | { kind: "tool.step"; payload: { step: InvestigationToolStep } }
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

export interface AgentReadinessResponse {
  service: "podo-core"
  status: "ready" | "degraded"
  version: string
  chat: {
    configured: boolean
    available: boolean
    sandbox: "read-only"
    reason?: "not_configured" | "codex_unavailable" | "version_mismatch" | "runtime_failed"
  }
}

export type AgentChatStatus = "ready" | "running" | "failed"

export interface AgentChatAnswer {
  schemaVersion: "podo.agent-answer.v1"
  finding: string
  causalPath: string[]
  evidence: string[]
  recommendation: string
  safety: "No changes were made."
  confidencePercent?: number
  incidentId?: string
}

export interface AgentChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  clientRequestId?: string
  answer?: AgentChatAnswer
}

export type AgentChatErrorCode =
  | "runtime_unavailable"
  | "turn_timeout"
  | "turn_failed"
  | "policy_denied"
  | "empty_response"
  | "invalid_response"

export interface AgentChat {
  id: string
  status: AgentChatStatus
  createdAt: string
  updatedAt: string
  lastSequence: number
  messages: AgentChatMessage[]
  error?: { code: AgentChatErrorCode; message: string }
}

export interface CreateAgentChatResponse { chat: AgentChat }
export interface GetAgentChatResponse { chat: AgentChat }

export interface SendAgentChatMessageRequest {
  content: string
  clientRequestId: string
}

export interface SendAgentChatMessageResponse {
  chat: AgentChat
  accepted: boolean
}

export interface CancelAgentChatTurnResponse { chat: AgentChat }

type AgentChatEventData =
  | { kind: "chat.started"; payload: { status: "ready" } }
  | { kind: "message.accepted"; payload: { message: AgentChatMessage } }
  | { kind: "output.delta"; payload: { text: string } }
  | { kind: "message.completed"; payload: { message: AgentChatMessage } }
  | { kind: "turn.cancelled"; payload: { status: "ready" } }
  | { kind: "chat.failed"; payload: { status: "failed"; error: NonNullable<AgentChat["error"]> } }

export type AgentChatEvent = {
  chatId: string
  sequence: number
  timestamp: string
} & AgentChatEventData

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
