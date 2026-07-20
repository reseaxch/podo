import type {
  BuildIncidentAuditEvent,
  GetBuildIncidentAuditResponse,
  GetIncidentAuditResponse,
  IncidentAuditEvent,
} from "@podo/contracts"

type AnyIncidentAuditEvent = IncidentAuditEvent | BuildIncidentAuditEvent

type IncidentAuditInput = AnyIncidentAuditEvent extends infer Event
  ? Event extends AnyIncidentAuditEvent
    ? Omit<Event, "sequence" | "occurredAt" | "incidentId">
    : never
  : never

export const INCIDENT_AUDIT_EVENT_LOG_LIMIT = 256

export class IncidentAuditStore {
  private readonly eventsByIncident = new Map<string, AnyIncidentAuditEvent[]>()
  private readonly truncatedToolStepsByIncident = new Map<string, number>()
  private readonly lastSequenceByIncident = new Map<string, number>()

  constructor(private readonly eventLogLimit = INCIDENT_AUDIT_EVENT_LOG_LIMIT) {
    if (!Number.isSafeInteger(eventLogLimit) || eventLogLimit < 1) {
      throw new Error("invalid_incident_audit_event_log_limit")
    }
  }

  append(incidentId: string, input: IncidentAuditInput): void {
    const events = this.eventsByIncident.get(incidentId) ?? []
    const payload = validateInput(input)
    const sequence = (this.lastSequenceByIncident.get(incidentId) ?? 0) + 1
    this.lastSequenceByIncident.set(incidentId, sequence)
    events.push({
      ...payload,
      sequence,
      occurredAt: new Date().toISOString(),
      incidentId,
    } as AnyIncidentAuditEvent)
    while (events.length > this.eventLogLimit) {
      const toolStepIndex = events.findIndex((event) => event.kind === "investigation.tool_step")
      if (toolStepIndex === -1) {
        events.shift()
      } else {
        events.splice(toolStepIndex, 1)
        this.truncatedToolStepsByIncident.set(
          incidentId,
          (this.truncatedToolStepsByIncident.get(incidentId) ?? 0) + 1,
        )
      }
    }
    this.eventsByIncident.set(incidentId, events)
  }

  get(incidentId: string): IncidentAuditEvent[] {
    return structuredClone(this.eventsByIncident.get(incidentId) ?? []) as IncidentAuditEvent[]
  }

  getBuild(incidentId: string): BuildIncidentAuditEvent[] {
    return structuredClone(this.eventsByIncident.get(incidentId) ?? []) as BuildIncidentAuditEvent[]
  }

  read(incidentId: string): GetIncidentAuditResponse {
    return {
      events: this.get(incidentId),
      retention: { truncatedToolSteps: this.truncatedToolStepsByIncident.get(incidentId) ?? 0 },
    }
  }

  readBuild(incidentId: string): GetBuildIncidentAuditResponse {
    return {
      events: this.getBuild(incidentId),
      retention: { truncatedToolSteps: this.truncatedToolStepsByIncident.get(incidentId) ?? 0 },
    }
  }
}

function validateInput(input: unknown): IncidentAuditInput {
  let value: unknown
  try { value = structuredClone(input) } catch { throw invalidEvent() }
  if (!isRecord(value) || typeof value.kind !== "string") throw invalidEvent()
  switch (value.kind) {
    case "build.signal_received":
      if (!hasExactKeys(value, ["kind", "deliveryId", "runId", "runAttempt", "headSha"])
        || !isIdentifier(value.deliveryId)
        || !isPositiveInteger(value.runId)
        || !isPositiveInteger(value.runAttempt)
        || !isCommitSha(value.headSha)) throw invalidEvent()
      break
    case "build.evidence_captured":
      if (!hasExactKeys(value, ["kind", "evidenceIds"]) || !isIdentifierList(value.evidenceIds)) throw invalidEvent()
      break
    case "build.incident_created":
      if (!hasExactKeys(value, ["kind"])) throw invalidEvent()
      break
    case "investigation.requested":
      if (!hasExactKeys(value, ["kind"])) throw invalidEvent()
      break
    case "investigation.started":
    case "investigation.completed":
    case "investigation.failed":
    case "investigation.cancelled":
      if (!hasExactKeys(value, ["kind", "investigationId"]) || !isIdentifier(value.investigationId)) throw invalidEvent()
      break
    case "investigation.tool_step": {
      const expectedKeys = value.outputSummary === undefined
        ? ["kind", "investigationId", "stepId", "tool", "status", "inputSummary"]
        : ["kind", "investigationId", "stepId", "tool", "status", "inputSummary", "outputSummary"]
      if (!hasExactKeys(value, expectedKeys)
        || !isIdentifier(value.investigationId)
        || !isIdentifier(value.stepId)
        || !isToolKind(value.tool)
        || !isToolStatus(value.status)
        || !isSafeToolSummary(value.inputSummary)
        || (value.outputSummary !== undefined && !isSafeToolSummary(value.outputSummary))
        || (value.status === "started" && value.outputSummary !== undefined)
        || (value.status !== "started" && value.outputSummary === undefined)) throw invalidEvent()
      break
    }
    case "investigation.approval_denied":
      if (!hasExactKeys(value, ["kind", "investigationId", "approvalKind"])
        || !isIdentifier(value.investigationId)
        || (value.approvalKind !== "command"
          && value.approvalKind !== "file_change"
          && value.approvalKind !== "permissions"
          && value.approvalKind !== "user_input")) throw invalidEvent()
      break
    case "investigation.diagnosis_validated":
      if (!hasExactKeys(value, ["kind", "investigationId", "evidenceIds"])
        || !isIdentifier(value.investigationId)
        || !isIdentifierList(value.evidenceIds)) throw invalidEvent()
      break
    case "investigation.diagnosis_rejected":
      if (!hasExactKeys(value, ["kind", "investigationId", "code"])
        || !isIdentifier(value.investigationId)
        || (value.code !== "invalid_output"
          && value.code !== "affected_service_mismatch"
          && value.code !== "investigation_failed"
          && value.code !== "investigation_cancelled")) throw invalidEvent()
      break
    case "issue.requested":
      if (!hasExactKeys(value, ["kind", "issueDeliveryId", "reason"])
        || !isIdentifier(value.issueDeliveryId)
        || (value.reason !== "remediation_not_safe"
          && value.reason !== "remediation_denied"
          && value.reason !== "remediation_failed")) throw invalidEvent()
      break
    case "issue.succeeded":
      if (!hasExactKeys(value, ["kind", "issueDeliveryId", "issueUrl"])
        || !isIdentifier(value.issueDeliveryId)
        || !isIdentifier(value.issueUrl)) throw invalidEvent()
      break
    case "issue.failed":
      if (!hasExactKeys(value, ["kind", "issueDeliveryId", "code"])
        || !isIdentifier(value.issueDeliveryId)
        || (value.code !== "policy_denied"
          && value.code !== "fallback_not_available"
          && value.code !== "confidential_content"
          && value.code !== "delivery_unavailable"
          && value.code !== "delivery_failed"
          && value.code !== "invalid_delivery_result")) throw invalidEvent()
      break
    case "build.retry_requested":
      if (!hasExactKeys(value, ["kind", "retryId", "approvalId"])
        || !isIdentifier(value.retryId)
        || !isIdentifier(value.approvalId)) throw invalidEvent()
      break
    case "build.retry_approval_decided":
      if (!hasExactKeys(value, ["kind", "retryId", "approvalId", "decision", "decidedBy"])
        || !isIdentifier(value.retryId)
        || !isIdentifier(value.approvalId)
        || !isOperatorIdentity(value.decidedBy)
        || (value.decision !== "approve" && value.decision !== "deny")) throw invalidEvent()
      break
    case "build.retry_dispatch_attempted":
      if (!hasExactKeys(value, [
        "kind", "retryId", "approvalId", "approvedBy", "approvedAt", "repository",
        "idempotencyKey", "runId", "headSha", "previousAttempt",
      ])
        || !isIdentifier(value.retryId)
        || !isIdentifier(value.approvalId)
        || !isOperatorIdentity(value.approvedBy)
        || !isIsoTimestamp(value.approvedAt)
        || !isRepositorySlug(value.repository)
        || !isIdentifier(value.idempotencyKey)
        || !isPositiveInteger(value.runId)
        || !isCommitSha(value.headSha)
        || !isPositiveInteger(value.previousAttempt)) throw invalidEvent()
      break
    case "build.retry_dispatched":
      if (!hasExactKeys(value, [
        "kind", "retryId", "approvalId", "approvedBy", "approvedAt", "providerStatus",
        "repository", "idempotencyKey", "runId", "headSha", "previousAttempt", "expectedRunAttempt",
      ])
        || !isIdentifier(value.retryId)
        || !isIdentifier(value.approvalId)
        || !isOperatorIdentity(value.approvedBy)
        || !isIsoTimestamp(value.approvedAt)
        || (value.providerStatus !== "accepted" && value.providerStatus !== "existing")
        || !isRepositorySlug(value.repository)
        || !isIdentifier(value.idempotencyKey)
        || !isPositiveInteger(value.runId)
        || !isCommitSha(value.headSha)
        || !isPositiveInteger(value.previousAttempt)
        || value.expectedRunAttempt !== (value.previousAttempt as number) + 1) throw invalidEvent()
      break
    case "build.retry_ci_result_observed":
      if (!hasExactKeys(value, ["kind", "retryId", "runId", "runAttempt", "headSha", "status", "conclusion"])
        || !isIdentifier(value.retryId)
        || !isPositiveInteger(value.runId)
        || !isPositiveInteger(value.runAttempt)
        || !isCommitSha(value.headSha)
        || !isBuildStatus(value.status)
        || !isBuildConclusion(value.conclusion)) throw invalidEvent()
      break
    case "build.retry_verified":
      if (!hasExactKeys(value, ["kind", "retryId", "runId", "runAttempt"])
        || !isIdentifier(value.retryId)
        || !isPositiveInteger(value.runId)
        || !isPositiveInteger(value.runAttempt)) throw invalidEvent()
      break
    case "build.retry_failed":
      if (!hasExactKeys(value, ["kind", "retryId", "code"])
        || !isIdentifier(value.retryId)
        || !isRetryErrorCode(value.code)) throw invalidEvent()
      break
    case "build.remediation_requested":
      if (!hasExactKeys(value, ["kind", "remediationId"]) || !isIdentifier(value.remediationId)) throw invalidEvent()
      break
    case "build.remediation_approval_decided":
      if (!hasExactKeys(value, ["kind", "remediationId", "approvalId", "decision", "decidedBy"])
        || !isIdentifier(value.remediationId)
        || !isIdentifier(value.approvalId)
        || !isOperatorIdentity(value.decidedBy)
        || (value.decision !== "approve" && value.decision !== "deny")) throw invalidEvent()
      break
    case "build.remediation_tested":
      if (!hasExactKeys(value, ["kind", "remediationId", "artifactId"])
        || !isIdentifier(value.remediationId)
        || !isIdentifier(value.artifactId)) throw invalidEvent()
      break
    case "build.remediation_failed":
      if (!hasExactKeys(value, ["kind", "remediationId", "code"])
        || !isIdentifier(value.remediationId)
        || !isIncidentRemediationErrorCode(value.code)) throw invalidEvent()
      break
    case "build.delivery_requested":
      if (!hasExactKeys(value, ["kind", "deliveryId", "remediationId", "artifactId", "approvalId"])
        || !isIdentifier(value.deliveryId)
        || !isIdentifier(value.remediationId)
        || !isIdentifier(value.artifactId)
        || !isIdentifier(value.approvalId)) throw invalidEvent()
      break
    case "build.delivery_approval_decided":
      if (!hasExactKeys(value, ["kind", "deliveryId", "approvalId", "decision", "decidedBy"])
        || !isIdentifier(value.deliveryId)
        || !isIdentifier(value.approvalId)
        || !isOperatorIdentity(value.decidedBy)
        || (value.decision !== "approve" && value.decision !== "deny")) throw invalidEvent()
      break
    case "build.delivery_failed":
      if (!hasExactKeys(value, ["kind", "deliveryId", "code"])
        || !isIdentifier(value.deliveryId)
        || !isIncidentDeliveryErrorCode(value.code)) throw invalidEvent()
      break
    case "build.remediation_delivered":
      if (!hasExactKeys(value, [
        "kind", "deliveryId", "remediationId", "artifactId", "approvalId", "approvedBy", "approvedAt",
        "provider", "repository", "pullRequestNumber", "pullRequestUrl", "providerStatus",
        "idempotencyKey", "baseCommit", "baseBranch", "headBranch", "headSha",
        "resultTreeOid", "patchSha256", "validationChecks", "evidenceIds",
      ])
        || !isIdentifier(value.deliveryId)
        || !isIdentifier(value.remediationId)
        || !isIdentifier(value.artifactId)
        || !isIdentifier(value.approvalId)
        || !isOperatorIdentity(value.approvedBy)
        || !isIsoTimestamp(value.approvedAt)
        || value.provider !== "github"
        || !isRepositorySlug(value.repository)
        || !isPositiveInteger(value.pullRequestNumber)
        || !isGitHubPullRequestUrl(value.pullRequestUrl, value.repository, value.pullRequestNumber)
        || (value.providerStatus !== "created" && value.providerStatus !== "existing")
        || !isIdentifier(value.idempotencyKey)
        || !isCommitSha(value.baseCommit)
        || !isSafeBranch(value.baseBranch)
        || !isSafeBranch(value.headBranch)
        || !isCommitSha(value.headSha)
        || !isCommitSha(value.resultTreeOid)
        || !isSha256(value.patchSha256)
        || !isBoundedTextList(value.validationChecks, 100, 500)
        || !isIdentifierList(value.evidenceIds)) throw invalidEvent()
      break
    case "build.remediation_ci_verification_started":
      if (!hasExactKeys(value, ["kind", "verificationId", "remediationId", "artifactId", "resultTreeOid", "headBranch", "headSha"])
        || !isIdentifier(value.verificationId)
        || !isIdentifier(value.remediationId)
        || !isIdentifier(value.artifactId)
        || !isCommitSha(value.resultTreeOid)
        || !isIdentifier(value.headBranch)
        || !isCommitSha(value.headSha)) throw invalidEvent()
      break
    case "build.remediation_ci_result_observed":
      if (!hasExactKeys(value, ["kind", "verificationId", "runId", "runAttempt", "headSha", "status", "conclusion"])
        || !isIdentifier(value.verificationId)
        || !isPositiveInteger(value.runId)
        || !isPositiveInteger(value.runAttempt)
        || !isCommitSha(value.headSha)
        || !isBuildStatus(value.status)
        || !isBuildConclusion(value.conclusion)) throw invalidEvent()
      break
    case "build.remediation_verified":
      if (!hasExactKeys(value, ["kind", "verificationId", "remediationId", "artifactId", "runId", "runAttempt", "headSha"])
        || !isIdentifier(value.verificationId)
        || !isIdentifier(value.remediationId)
        || !isIdentifier(value.artifactId)
        || !isPositiveInteger(value.runId)
        || !isPositiveInteger(value.runAttempt)
        || !isCommitSha(value.headSha)) throw invalidEvent()
      break
    case "build.remediation_ci_failed":
      if (!hasExactKeys(value, ["kind", "verificationId", "code"])
        || !isIdentifier(value.verificationId)
        || !isRemediationVerificationErrorCode(value.code)) throw invalidEvent()
      break
    default:
      throw invalidEvent()
  }
  return value as IncidentAuditInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",")
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value === value.trim()
}

function isOperatorIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 320
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function isIdentifierList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 500
    && value.every(isIdentifier)
    && new Set(value).size === value.length
}

function isBoundedTextList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximumItems
    && value.every((item) => typeof item === "string"
      && item.length > 0
      && item.length <= maximumLength
      && item === item.trim()
      && !item.includes("\0"))
}

const safeToolSummaryPatterns = [
  /^Command content withheld \(\d{1,16} characters\)\.$/,
  /^Process output unavailable; exit code (?:-?\d{1,10}|unavailable)\.$/,
  /^Process output withheld \(\d{1,16} characters\); exit code (?:-?\d{1,10}|unavailable)\.$/,
  /^File change content withheld \(\d{1,16} changes\)\.$/,
  /^File change result content withheld \(\d{1,16} changes\)\.$/,
  /^MCP arguments withheld\.$/,
  /^MCP result content (?:unavailable|withheld)\.$/,
  /^Dynamic tool arguments withheld\.$/,
  /^Dynamic tool result content unavailable\.$/,
  /^Dynamic tool result content withheld \(\d{1,16} items\)\.$/,
  /^Collaboration prompt unavailable\.$/,
  /^Collaboration prompt withheld \(\d{1,16} characters\)\.$/,
  /^Collaboration result details withheld\.$/,
  /^Search query withheld \(\d{1,16} characters\)\.$/,
  /^Search result details unavailable in item lifecycle\.$/,
  /^Image path withheld\.$/,
  /^Image content unavailable in item lifecycle\.$/,
  /^Sleep duration (?:\d{1,9}|unavailable) ms\.$/,
  /^Sleep completed\.$/,
  /^Image generation prompt unavailable in item lifecycle\.$/,
  /^Generated image content unavailable\.$/,
  /^Generated image content withheld \(\d{1,16} characters\)\.$/,
  /^Tool (?:input|output) summary unavailable\.$/,
] as const

function isSafeToolSummary(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && safeToolSummaryPatterns.some((pattern) => pattern.test(value))
}

function isToolKind(value: unknown): boolean {
  return typeof value === "string" && [
    "command",
    "file_change",
    "mcp",
    "dynamic",
    "collaboration",
    "web_search",
    "image_view",
    "sleep",
    "image_generation",
  ].includes(value)
}

function isToolStatus(value: unknown): boolean {
  return value === "started" || value === "completed" || value === "failed"
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isRepositorySlug(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)
    && !value.split("/").includes("..")
}

function isSafeBranch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.includes("..")
    && !value.includes("//")
}

function isGitHubPullRequestUrl(value: unknown, repository: string, pullRequestNumber: number): boolean {
  if (typeof value !== "string" || value.length > 2_048) return false
  try {
    const url = new URL(value)
    return url.origin === "https://github.com"
      && url.pathname === `/${repository}/pull/${pullRequestNumber}`
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function isBuildStatus(value: unknown): boolean {
  return typeof value === "string"
    && ["requested", "queued", "pending", "waiting", "in_progress", "completed"].includes(value)
}

function isBuildConclusion(value: unknown): boolean {
  return value === null || (typeof value === "string"
    && ["action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out"].includes(value))
}

function isRetryErrorCode(value: unknown): boolean {
  return typeof value === "string" && [
    "policy_denied",
    "retry_unavailable",
    "retry_failed",
    "invalid_retry_result",
    "ci_result_mismatch",
    "ci_failed",
    "verification_timeout",
  ].includes(value)
}

function isRemediationVerificationErrorCode(value: unknown): boolean {
  return typeof value === "string" && [
    "remediation_not_verified",
    "delivery_not_verified",
    "ci_result_mismatch",
    "ci_failed",
    "verification_timeout",
  ].includes(value)
}

function isIncidentRemediationErrorCode(value: unknown): boolean {
  return typeof value === "string" && [
    "execution_failed",
    "invalid_executor_result",
    "verification_failed",
    "policy_denied",
  ].includes(value)
}

function isIncidentDeliveryErrorCode(value: unknown): boolean {
  return typeof value === "string" && [
    "policy_denied",
    "artifact_changed",
    "delivery_failed",
    "invalid_delivery_result",
  ].includes(value)
}

function invalidEvent(): Error {
  return new Error("invalid_incident_audit_event")
}
