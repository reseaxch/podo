import { createHash, randomUUID } from "node:crypto"

import type {
  IncidentIssueDelivery,
  IncidentIssueErrorCode,
  IncidentIssueFallbackReason,
  ValidatedIncidentDiagnosis,
} from "@podo/contracts"
import { evaluateReaction } from "@podo/domain"

import type { SettingsStore } from "../../settings"
import type { IncidentAuditStore } from "../audit/incident-audit"
import type { IncidentMonitor } from "../incidents/incident-monitor"
import type { IncidentInvestigationCoordinator } from "../investigation/incident-investigation"
import type { IncidentRemediationService } from "./incident-remediation"

export interface IssueDeliveryInput {
  issueDeliveryId: string
  authorization: {
    kind: "core.issue_fallback.v1"
    authorizationId: string
    authorizedAt: string
  }
  draft: {
    id: string
    idempotencyKey: string
    contentSha256: string
    content: {
      incidentId: string
      reason: IncidentIssueFallbackReason
      title: string
      body: string
      evidenceIds: string[]
    }
  }
}

export interface IssueDeliveryPort {
  create(input: IssueDeliveryInput): Promise<unknown>
}

export interface IssueDeliveryConfig {
  expectedRepository: string
  port: IssueDeliveryPort
}

type IssueResult =
  | { ok: true; created: boolean; issueDelivery: IncidentIssueDelivery }
  | { ok: false; status: 404 | 409 | 422 | 503; error: "not_found" | IncidentIssueErrorCode; message: string }

type GetIssueResult =
  | { ok: true; issueDelivery: IncidentIssueDelivery }
  | { ok: false; status: 404; error: "not_found"; message: string }

interface IssueRecord {
  issueDelivery: IncidentIssueDelivery
  execution: Promise<void>
}

export class IncidentIssueService {
  private readonly byIncident = new Map<string, IssueRecord>()
  private readonly pending = new Map<string, Promise<IssueResult>>()

  constructor(
    private readonly incidents: IncidentMonitor,
    private readonly investigations: IncidentInvestigationCoordinator,
    private readonly remediations: IncidentRemediationService,
    private readonly settings: SettingsStore,
    private readonly audit: IncidentAuditStore,
    private readonly config?: IssueDeliveryConfig,
  ) {
    if (config && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(config.expectedRepository)) {
      throw new Error("invalid_issue_delivery_repository")
    }
  }

  async start(incidentId: string): Promise<IssueResult> {
    const existing = this.byIncident.get(incidentId)
    if (existing) {
      await existing.execution
      return { ok: true, created: false, issueDelivery: copy(existing.issueDelivery) }
    }
    const pending = this.pending.get(incidentId)
    if (pending) {
      const result = await pending
      return result.ok ? { ...result, created: false } : result
    }
    const operation = this.startNew(incidentId)
    this.pending.set(incidentId, operation)
    try { return await operation } finally { this.pending.delete(incidentId) }
  }

  get(incidentId: string): GetIssueResult {
    const record = this.byIncident.get(incidentId)
    return record
      ? { ok: true, issueDelivery: copy(record.issueDelivery) }
      : { ok: false, status: 404, error: "not_found", message: "Incident issue delivery was not found" }
  }

  private async startNew(incidentId: string): Promise<IssueResult> {
    const incident = this.incidents.getIncident(incidentId)
    if (!incident) return { ok: false, status: 404, error: "not_found", message: "Incident was not found" }
    const publicIncident = this.investigations.publicIncident(incident)
    const diagnosis = publicIncident.diagnosis
    if (!diagnosis || diagnosis.status !== "validated") {
      return { ok: false, status: 409, error: "fallback_not_available", message: "A validated diagnosis is required" }
    }

    let reason: IncidentIssueFallbackReason | null = diagnosis.safeToAttemptFix ? null : "remediation_not_safe"
    if (!reason) {
      const remediation = this.remediations.get(incidentId)
      if (remediation.ok && remediation.remediation.status === "failed") reason = "remediation_failed"
      if (remediation.ok && remediation.remediation.status === "denied") reason = "remediation_denied"
    }
    if (!reason) {
      return { ok: false, status: 409, error: "fallback_not_available", message: "Issue fallback requires an unsafe, failed, or denied remediation" }
    }
    if (!this.config) {
      return { ok: false, status: 503, error: "delivery_unavailable", message: "Issue delivery is unavailable" }
    }
    const mode = this.settings.get().autonomyMode
    const policy = evaluateReaction({ mode, action: "draft_issue", approval: "not_requested", regression: "not_run", target: "none" })
    if (!policy.allowed) {
      return { ok: false, status: 409, error: "policy_denied", message: `Autonomy mode ${mode} forbids issue fallback` }
    }
    if (containsConfidentialContent({
      incidentId,
      affectedService: incident.affectedService,
      deploymentId: incident.deploymentId,
      diagnosis,
    })) {
      return { ok: false, status: 422, error: "confidential_content", message: "confidential_content" }
    }

    const now = new Date().toISOString()
    const issueDeliveryId = `issue_delivery_${randomUUID()}`
    const content = buildIssueContent(incidentId, reason, incident.affectedService, incident.deploymentId, diagnosis)
    const draft = {
      id: `issue_draft_${randomUUID()}`,
      idempotencyKey: issueDeliveryId,
      contentSha256: computeIssueContentSha256(content),
      content,
    }
    const issueDelivery: IncidentIssueDelivery = {
      id: issueDeliveryId,
      incidentId,
      reason,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    }
    const authorization = {
      kind: "core.issue_fallback.v1" as const,
      authorizationId: `authorization_${randomUUID()}`,
      authorizedAt: now,
    }
    this.audit.append(incidentId, { kind: "issue.requested", issueDeliveryId: issueDelivery.id, reason })
    const record: IssueRecord = {
      issueDelivery,
      execution: Promise.resolve(),
    }
    record.execution = this.execute(record, {
      issueDeliveryId: issueDelivery.id,
      authorization,
      draft,
    })
    this.byIncident.set(incidentId, record)
    await record.execution
    return { ok: true, created: true, issueDelivery: copy(record.issueDelivery) }
  }

  private async execute(record: IssueRecord, input: IssueDeliveryInput): Promise<void> {
    let raw: unknown
    try { raw = await this.config!.port.create(copy(input)) } catch {
      this.fail(record, "delivery_failed", "Issue delivery failed")
      return
    }
    const issue = parseIssueResult(raw, this.config!.expectedRepository, input)
    if (!issue) {
      this.fail(record, "invalid_delivery_result", "Issue delivery returned an invalid result")
      return
    }
    record.issueDelivery.status = "created"
    record.issueDelivery.updatedAt = new Date().toISOString()
    record.issueDelivery.issue = issue
    this.audit.append(record.issueDelivery.incidentId, {
      kind: "issue.succeeded",
      issueDeliveryId: record.issueDelivery.id,
      issueUrl: issue.url,
    })
  }

  private fail(record: IssueRecord, code: IncidentIssueErrorCode, message: string): void {
    record.issueDelivery.status = "failed"
    record.issueDelivery.updatedAt = new Date().toISOString()
    record.issueDelivery.error = { code, message }
    this.audit.append(record.issueDelivery.incidentId, { kind: "issue.failed", issueDeliveryId: record.issueDelivery.id, code })
  }
}

function parseIssueResult(
  value: unknown,
  repository: string,
  input: IssueDeliveryInput,
): NonNullable<IncidentIssueDelivery["issue"]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (!hasExactKeys(result, ["provider", "status", "repository", "number", "url", "state", "draft", "authorization", "incident"])
    || result.provider !== "github"
    || (result.status !== "created" && result.status !== "existing")
    || result.repository !== repository
    || !Number.isSafeInteger(result.number)
    || (result.number as number) < 1
    || result.url !== `https://github.com/${repository}/issues/${result.number}`
    || result.state !== "open"
    || !matchesDraft(result.draft, input)
    || !matchesAuthorization(result.authorization, input)
    || !matchesIncident(result.incident, input)) return null
  return {
    provider: "github",
    repository,
    number: result.number as number,
    url: result.url as string,
    state: "open",
    providerStatus: result.status,
    draftId: input.draft.id,
    idempotencyKey: input.draft.idempotencyKey,
    contentSha256: input.draft.contentSha256,
  }
}

function buildIssueContent(
  incidentId: string,
  reason: IncidentIssueFallbackReason,
  affectedService: string,
  deploymentId: string,
  diagnosis: ValidatedIncidentDiagnosis,
): IssueDeliveryInput["draft"]["content"] {
  const evidenceIds = [...diagnosis.evidenceIds].sort()
  return {
    incidentId,
    reason,
    title: `Incident ${affectedService}: remediation fallback`,
    body: [
      `Incident: ${incidentId}`,
      `Service: ${affectedService}`,
      `Deployment: ${deploymentId}`,
      `Fallback reason: ${reason}`,
      "",
      "Diagnosis",
      diagnosis.summary,
      `Probable root cause: ${diagnosis.probableRootCause}`,
      `Confidence: ${diagnosis.confidence.value}/10000`,
      "",
      "Proposed remediation",
      diagnosis.recommendedAction,
      "",
      "Evidence",
      ...evidenceIds.map((id) => `- ${id}`),
      "",
      "No verified patch is attached. Podo does not publish unverified remediation output.",
    ].join("\n"),
    evidenceIds,
  }
}

function computeIssueContentSha256(content: IssueDeliveryInput["draft"]["content"]): string {
  return createHash("sha256").update(JSON.stringify({
    incidentId: content.incidentId,
    reason: content.reason,
    title: content.title,
    body: content.body,
    evidenceIds: [...content.evidenceIds],
  })).digest("hex")
}

function containsConfidentialContent(value: unknown): boolean {
  const text = JSON.stringify(value)
  return /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/.test(text)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\b/.test(text)
    || /\b(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/i.test(text)
}

function matchesDraft(value: unknown, input: IssueDeliveryInput): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "idempotencyKey", "contentSha256"])) return false
  return value.id === input.draft.id
    && value.idempotencyKey === input.draft.idempotencyKey
    && value.contentSha256 === input.draft.contentSha256
}

function matchesAuthorization(value: unknown, input: IssueDeliveryInput): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "authorizedAt"])) return false
  return value.id === input.authorization.authorizationId
    && value.authorizedAt === input.authorization.authorizedAt
}

function matchesIncident(value: unknown, input: IssueDeliveryInput): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "reason", "evidenceIds"]) || !Array.isArray(value.evidenceIds)) return false
  return value.id === input.draft.content.incidentId
    && value.reason === input.draft.content.reason
    && value.evidenceIds.length === input.draft.content.evidenceIds.length
    && value.evidenceIds.every((id, index) => id === input.draft.content.evidenceIds[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",")
}

function copy<T>(value: T): T { return structuredClone(value) }
