import { createHash, randomUUID } from "node:crypto"

import type {
  IncidentIssueDelivery,
  IncidentIssueDeliveryErrorCode,
  IncidentIssueDraft,
} from "@podo/contracts"
import { evaluateReaction } from "@podo/domain"

import type { SettingsStore } from "../../settings"
import type { IncidentMonitor } from "../incidents/incident-monitor"
import type { IncidentInvestigationCoordinator } from "../investigation/incident-investigation"
import type { IncidentRemediationService } from "./incident-remediation"

export interface IssueDeliveryInput {
  issueDeliveryId: string
  incidentId: string
  remediationId: string
  authorization: {
    kind: "core.issue_delivery.v1"
    approvalId: string
    approvedAt: string
  }
  draft: IncidentIssueDraft
}

export interface IssueDeliveryPort {
  deliver(input: IssueDeliveryInput): Promise<unknown>
}

export interface IssueDeliveryConfig {
  expectedRepository: string
  port: IssueDeliveryPort
}

interface IssueDeliveryRecord {
  issueDelivery: IncidentIssueDelivery
  authorization?: IssueDeliveryInput["authorization"]
  execution?: Promise<void>
}

export type StartIncidentIssueDeliveryResult =
  | { ok: true; created: boolean; issueDelivery: IncidentIssueDelivery }
  | { ok: false; status: 404; error: "not_found"; message: string }
  | { ok: false; status: 409; error: "remediation_not_failed" | "diagnosis_not_validated" | "policy_denied"; message: string }
  | { ok: false; status: 503; error: "delivery_unavailable"; message: string }

export type GetIncidentIssueDeliveryResult =
  | { ok: true; issueDelivery: IncidentIssueDelivery }
  | { ok: false; status: 404; error: "not_found"; message: string }

export type DecideIncidentIssueDeliveryResult =
  | { ok: true; issueDelivery: IncidentIssueDelivery }
  | { ok: false; status: 404; error: "not_found" | "approval_not_found"; message: string }
  | { ok: false; status: 409; error: "approval_already_decided"; message: string }

export class IncidentIssueDeliveryService {
  private readonly byIncident = new Map<string, IssueDeliveryRecord>()

  constructor(
    private readonly incidents: IncidentMonitor,
    private readonly investigations: IncidentInvestigationCoordinator,
    private readonly remediations: IncidentRemediationService,
    private readonly settings: SettingsStore,
    private readonly config?: IssueDeliveryConfig,
  ) {
    if (config && !isRepositoryIdentity(config.expectedRepository)) {
      throw new Error("invalid_issue_delivery_repository")
    }
  }

  start(incidentId: string): StartIncidentIssueDeliveryResult {
    const existing = this.byIncident.get(incidentId)
    if (existing) return { ok: true, created: false, issueDelivery: copy(existing.issueDelivery) }
    if (!this.config) return { ok: false, status: 503, error: "delivery_unavailable", message: "Issue delivery is unavailable" }

    const draftResult = this.buildCurrentDraft(incidentId)
    if (!draftResult.ok) return draftResult

    const mode = this.settings.get().autonomyMode
    const policy = evaluateReaction({
      mode,
      action: "create_issue",
      approval: "pending",
      regression: "failed",
      target: "none",
    })
    if (policy.allowed || policy.reason !== "approval_required" || !policy.requiresApproval) {
      return { ok: false, status: 409, error: "policy_denied", message: `Autonomy mode ${mode} does not allow approval-gated issue delivery` }
    }

    const now = new Date().toISOString()
    const record: IssueDeliveryRecord = {
      issueDelivery: {
        id: `issue_delivery_${randomUUID()}`,
        incidentId,
        remediationId: draftResult.remediationId,
        draft: draftResult.draft,
        status: "pending_approval",
        approval: { id: `approval_${randomUUID()}`, status: "pending" },
        createdAt: now,
        updatedAt: now,
      },
    }
    this.byIncident.set(incidentId, record)
    this.remediations.appendAudit(incidentId, {
      kind: "issue_delivery.requested",
      issueDeliveryId: record.issueDelivery.id,
      draftId: record.issueDelivery.draft.id,
    })
    return { ok: true, created: true, issueDelivery: copy(record.issueDelivery) }
  }

  get(incidentId: string): GetIncidentIssueDeliveryResult {
    const record = this.byIncident.get(incidentId)
    return record
      ? { ok: true, issueDelivery: copy(record.issueDelivery) }
      : { ok: false, status: 404, error: "not_found", message: "Incident issue delivery was not found" }
  }

  async decide(incidentId: string, approvalId: string, decision: "approve" | "deny"): Promise<DecideIncidentIssueDeliveryResult> {
    const record = this.byIncident.get(incidentId)
    if (!record) return { ok: false, status: 404, error: "not_found", message: "Incident issue delivery was not found" }
    if (record.issueDelivery.approval.id !== approvalId) {
      return { ok: false, status: 404, error: "approval_not_found", message: "Issue delivery approval was not found" }
    }

    const decided = record.issueDelivery.approval.status
    if (decided !== "pending") {
      if ((decided === "approved" && decision === "approve") || (decided === "denied" && decision === "deny")) {
        if (record.execution) await record.execution
        return { ok: true, issueDelivery: copy(record.issueDelivery) }
      }
      return { ok: false, status: 409, error: "approval_already_decided", message: "Issue delivery approval already has a different decision" }
    }

    record.issueDelivery.updatedAt = new Date().toISOString()
    if (decision === "deny") {
      record.issueDelivery.approval.status = "denied"
      record.issueDelivery.status = "denied"
      this.auditDecision(record, approvalId, decision)
      return { ok: true, issueDelivery: copy(record.issueDelivery) }
    }

    record.issueDelivery.approval.status = "approved"
    record.issueDelivery.status = "delivering"
    record.authorization = {
      kind: "core.issue_delivery.v1",
      approvalId,
      approvedAt: record.issueDelivery.updatedAt,
    }
    this.auditDecision(record, approvalId, decision)
    record.execution = this.execute(record)
    await record.execution
    return { ok: true, issueDelivery: copy(record.issueDelivery) }
  }

  private async execute(record: IssueDeliveryRecord): Promise<void> {
    const policy = evaluateReaction({
      mode: this.settings.get().autonomyMode,
      action: "create_issue",
      approval: "approved",
      regression: "failed",
      target: "none",
    })
    if (!policy.allowed || !this.config || !record.authorization) {
      this.fail(record, "policy_denied", "Issue delivery was denied by the active policy")
      return
    }

    const current = this.buildCurrentDraft(record.issueDelivery.incidentId)
    if (!current.ok
      || current.remediationId !== record.issueDelivery.remediationId
      || JSON.stringify(current.draft) !== JSON.stringify(record.issueDelivery.draft)) {
      this.fail(record, "draft_changed", "The Core-authored issue draft changed before delivery")
      return
    }

    this.remediations.appendAudit(record.issueDelivery.incidentId, {
      kind: "issue_delivery.started",
      issueDeliveryId: record.issueDelivery.id,
      draftId: record.issueDelivery.draft.id,
    })

    let raw: unknown
    try {
      raw = await this.config.port.deliver({
        issueDeliveryId: record.issueDelivery.id,
        incidentId: record.issueDelivery.incidentId,
        remediationId: record.issueDelivery.remediationId,
        authorization: copy(record.authorization),
        draft: copy(record.issueDelivery.draft),
      })
    } catch {
      this.fail(record, "delivery_failed", "Issue delivery failed")
      return
    }

    const result = parseDeliveryResult(raw, record.issueDelivery.draft.id, this.config.expectedRepository)
    if (!result) {
      this.fail(record, "invalid_delivery_result", "Issue delivery returned an invalid result")
      return
    }

    record.issueDelivery.issue = result
    record.issueDelivery.status = "delivered"
    record.issueDelivery.updatedAt = new Date().toISOString()
    this.remediations.appendAudit(record.issueDelivery.incidentId, {
      kind: "issue_delivery.succeeded",
      issueDeliveryId: record.issueDelivery.id,
      draftId: record.issueDelivery.draft.id,
      issueUrl: result.url,
    })
  }

  private buildCurrentDraft(incidentId: string):
    | { ok: true; remediationId: string; draft: IncidentIssueDraft }
    | Exclude<StartIncidentIssueDeliveryResult, { ok: true }> {
    const remediationResult = this.remediations.get(incidentId)
    if (!remediationResult.ok) return { ok: false, status: 404, error: "not_found", message: "Incident remediation was not found" }
    const remediation = remediationResult.remediation
    if (remediation.status !== "failed" || !remediation.error) {
      return { ok: false, status: 409, error: "remediation_not_failed", message: "A terminal failed remediation is required" }
    }
    const incident = this.incidents.getIncident(incidentId)
    if (!incident) return { ok: false, status: 404, error: "not_found", message: "Incident was not found" }
    const diagnosis = this.investigations.publicIncident(incident).diagnosis
    if (!diagnosis || diagnosis.status !== "validated") {
      return { ok: false, status: 409, error: "diagnosis_not_validated", message: "A validated authoritative diagnosis is required" }
    }
    return {
      ok: true,
      remediationId: remediation.id,
      draft: createIssueDraft(incidentId, remediation.id, remediation.error.code, diagnosis),
    }
  }

  private auditDecision(record: IssueDeliveryRecord, approvalId: string, decision: "approve" | "deny"): void {
    this.remediations.appendAudit(record.issueDelivery.incidentId, {
      kind: "issue_delivery.approval_decided",
      issueDeliveryId: record.issueDelivery.id,
      approvalId,
      decision,
    })
  }

  private fail(record: IssueDeliveryRecord, code: IncidentIssueDeliveryErrorCode, message: string): void {
    record.issueDelivery.status = "failed"
    record.issueDelivery.updatedAt = new Date().toISOString()
    delete record.issueDelivery.issue
    record.issueDelivery.error = { code, message }
    this.remediations.appendAudit(record.issueDelivery.incidentId, {
      kind: "issue_delivery.failed",
      issueDeliveryId: record.issueDelivery.id,
      code,
    })
  }
}

function createIssueDraft(
  incidentId: string,
  remediationId: string,
  remediationFailureCode: IncidentIssueDraft["remediationFailureCode"],
  diagnosis: Extract<ReturnType<IncidentInvestigationCoordinator["publicIncident"]>["diagnosis"], { status: "validated" }>,
): IncidentIssueDraft {
  const evidenceIds = [...diagnosis.evidenceIds].sort(compareCodeUnits)
  const title = boundedLine(`[Podo] ${diagnosis.affectedService} remediation requires manual follow-up`, 240)
  const body = [
    "## Incident diagnosis",
    "",
    safeMarkdown(diagnosis.summary),
    "",
    `**Affected service:** ${safeMarkdown(diagnosis.affectedService)}`,
    `**Probable root cause:** ${safeMarkdown(diagnosis.probableRootCause)}`,
    `**Recommended action:** ${safeMarkdown(diagnosis.recommendedAction)}`,
    `**Remediation failure:** \`${remediationFailureCode}\``,
    "",
    "## Evidence",
    "",
    ...evidenceIds.map((id) => `- \`${id}\``),
    "",
    "The automated remediation did not pass Podo verification. No unverified patch or runtime output is included.",
  ].join("\n")
  const identity = { incidentId, remediationId, remediationFailureCode, title, body, evidenceIds }
  const id = `issue_draft_${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24)}`
  return { id, title, body, evidenceIds, remediationFailureCode }
}

function parseDeliveryResult(
  value: unknown,
  draftId: string,
  expectedRepository: string,
): NonNullable<IncidentIssueDelivery["issue"]> | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["provider", "repository", "number", "url", "draftId"])) return null
  if (value.provider !== "github"
    || value.repository !== expectedRepository
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || value.url !== `https://github.com/${expectedRepository}/issues/${value.number}`
    || value.draftId !== draftId) return null
  return {
    provider: "github",
    repository: expectedRepository,
    number: value.number as number,
    url: value.url,
    draftId,
  }
}

function safeMarkdown(value: string): string {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\r\n]+/g, " ").trim()
}

function boundedLine(value: string, maximum: number): string {
  return safeMarkdown(value).slice(0, maximum).trim()
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRepositoryIdentity(value: string): boolean {
  const parts = value.split("/")
  return parts.length === 2
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/.test(parts[0]!)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(parts[1]!)
    && !parts.includes("..")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function copy<T>(value: T): T {
  return structuredClone(value)
}
