import { randomUUID } from "node:crypto"

import type {
  IncidentDelivery,
  IncidentDeliveryErrorCode,
  IncidentRemediationArtifact,
} from "@podo/contracts"
import { evaluateReaction } from "@podo/domain"

import type { SettingsStore } from "../../settings"
import type { IncidentRemediationService } from "./incident-remediation"

export interface PullRequestDeliveryInput {
  incidentId: string
  remediationId: string
  artifact: IncidentRemediationArtifact
}

export interface PullRequestDeliveryPort {
  deliver(input: PullRequestDeliveryInput): Promise<unknown>
}

interface DeliveryRecord {
  delivery: IncidentDelivery
  artifact: IncidentRemediationArtifact
  execution?: Promise<void>
}

export type StartIncidentDeliveryResult =
  | { ok: true; created: boolean; delivery: IncidentDelivery }
  | { ok: false; status: 404; error: "not_found"; message: string }
  | { ok: false; status: 409; error: "remediation_not_verified" | "policy_denied"; message: string }
  | { ok: false; status: 503; error: "delivery_unavailable"; message: string }

export type GetIncidentDeliveryResult =
  | { ok: true; delivery: IncidentDelivery }
  | { ok: false; status: 404; error: "not_found"; message: string }

export type DecideIncidentDeliveryResult =
  | { ok: true; delivery: IncidentDelivery }
  | { ok: false; status: 404; error: "not_found" | "approval_not_found"; message: string }
  | { ok: false; status: 409; error: "approval_already_decided"; message: string }

export class IncidentDeliveryService {
  private readonly byIncident = new Map<string, DeliveryRecord>()

  constructor(
    private readonly remediations: IncidentRemediationService,
    private readonly settings: SettingsStore,
    private readonly port?: PullRequestDeliveryPort,
  ) {}

  start(incidentId: string): StartIncidentDeliveryResult {
    const existing = this.byIncident.get(incidentId)
    if (existing) return { ok: true, created: false, delivery: copy(existing.delivery) }

    const remediationResult = this.remediations.get(incidentId)
    if (!remediationResult.ok) return { ok: false, status: 404, error: "not_found", message: "Incident remediation was not found" }
    const remediation = remediationResult.remediation
    if (remediation.status !== "completed" || !remediation.artifact) {
      return { ok: false, status: 409, error: "remediation_not_verified", message: "A completed verified remediation artifact is required" }
    }
    if (!this.port) return { ok: false, status: 503, error: "delivery_unavailable", message: "Pull request delivery is unavailable" }

    const mode = this.settings.get().autonomyMode
    const policy = evaluateReaction({
      mode,
      action: "create_pull_request",
      approval: "pending",
      regression: "passed",
      target: "isolated_checkout",
    })
    if (policy.allowed || policy.reason !== "approval_required" || !policy.requiresApproval) {
      return { ok: false, status: 409, error: "policy_denied", message: `Autonomy mode ${mode} does not allow approval-gated pull request delivery` }
    }

    const now = new Date().toISOString()
    const record: DeliveryRecord = {
      artifact: copy(remediation.artifact),
      delivery: {
        id: `delivery_${randomUUID()}`,
        incidentId,
        remediationId: remediation.id,
        artifactSha256: remediation.artifact.patch.sha256,
        status: "pending_approval",
        approval: { id: `approval_${randomUUID()}`, status: "pending" },
        createdAt: now,
        updatedAt: now,
      },
    }
    this.byIncident.set(incidentId, record)
    this.remediations.appendAudit(incidentId, {
      kind: "delivery.requested",
      deliveryId: record.delivery.id,
      artifactSha256: record.delivery.artifactSha256,
    })
    return { ok: true, created: true, delivery: copy(record.delivery) }
  }

  get(incidentId: string): GetIncidentDeliveryResult {
    const record = this.byIncident.get(incidentId)
    return record
      ? { ok: true, delivery: copy(record.delivery) }
      : { ok: false, status: 404, error: "not_found", message: "Incident delivery was not found" }
  }

  async decide(incidentId: string, approvalId: string, decision: "approve" | "deny"): Promise<DecideIncidentDeliveryResult> {
    const record = this.byIncident.get(incidentId)
    if (!record) return { ok: false, status: 404, error: "not_found", message: "Incident delivery was not found" }
    if (record.delivery.approval.id !== approvalId) {
      return { ok: false, status: 404, error: "approval_not_found", message: "Delivery approval was not found" }
    }

    const decided = record.delivery.approval.status
    if (decided !== "pending") {
      if ((decided === "approved" && decision === "approve") || (decided === "denied" && decision === "deny")) {
        if (record.execution) await record.execution
        return { ok: true, delivery: copy(record.delivery) }
      }
      return { ok: false, status: 409, error: "approval_already_decided", message: "Delivery approval already has a different decision" }
    }

    record.delivery.updatedAt = new Date().toISOString()
    if (decision === "deny") {
      record.delivery.approval.status = "denied"
      record.delivery.status = "denied"
      this.auditDecision(record, approvalId, decision)
      return { ok: true, delivery: copy(record.delivery) }
    }

    record.delivery.approval.status = "approved"
    record.delivery.status = "delivering"
    this.auditDecision(record, approvalId, decision)
    record.execution = this.execute(record)
    await record.execution
    return { ok: true, delivery: copy(record.delivery) }
  }

  private async execute(record: DeliveryRecord): Promise<void> {
    const policy = evaluateReaction({
      mode: this.settings.get().autonomyMode,
      action: "create_pull_request",
      approval: "approved",
      regression: "passed",
      target: "isolated_checkout",
    })
    if (!policy.allowed || !this.port) {
      this.fail(record, "policy_denied", "Pull request delivery was denied by the active policy")
      return
    }

    const current = this.remediations.get(record.delivery.incidentId)
    if (!current.ok
      || current.remediation.status !== "completed"
      || !current.remediation.artifact
      || JSON.stringify(current.remediation.artifact) !== JSON.stringify(record.artifact)) {
      this.fail(record, "artifact_changed", "The verified remediation artifact changed before delivery")
      return
    }

    this.remediations.appendAudit(record.delivery.incidentId, {
      kind: "delivery.started",
      deliveryId: record.delivery.id,
      artifactSha256: record.delivery.artifactSha256,
    })

    let raw: unknown
    try {
      raw = await this.port.deliver({
        incidentId: record.delivery.incidentId,
        remediationId: record.delivery.remediationId,
        artifact: copy(record.artifact),
      })
    } catch {
      this.fail(record, "delivery_failed", "Pull request delivery failed")
      return
    }

    const result = parseDeliveryResult(raw, record.artifact)
    if (!result) {
      this.fail(record, "invalid_delivery_result", "Pull request delivery returned an invalid result")
      return
    }

    record.delivery.pullRequest = result
    record.delivery.status = "delivered"
    record.delivery.updatedAt = new Date().toISOString()
    this.remediations.appendAudit(record.delivery.incidentId, {
      kind: "delivery.succeeded",
      deliveryId: record.delivery.id,
      artifactSha256: record.delivery.artifactSha256,
      pullRequestUrl: result.url,
    })
  }

  private auditDecision(record: DeliveryRecord, approvalId: string, decision: "approve" | "deny"): void {
    this.remediations.appendAudit(record.delivery.incidentId, {
      kind: "delivery.approval_decided",
      deliveryId: record.delivery.id,
      approvalId,
      decision,
    })
  }

  private fail(record: DeliveryRecord, code: IncidentDeliveryErrorCode, message: string): void {
    record.delivery.status = "failed"
    record.delivery.updatedAt = new Date().toISOString()
    delete record.delivery.pullRequest
    record.delivery.error = { code, message }
    this.remediations.appendAudit(record.delivery.incidentId, {
      kind: "delivery.failed",
      deliveryId: record.delivery.id,
      code,
    })
  }
}

function parseDeliveryResult(value: unknown, artifact: IncidentRemediationArtifact): NonNullable<IncidentDelivery["pullRequest"]> | null {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "provider",
    "repository",
    "number",
    "url",
    "baseCommit",
    "headBranch",
    "artifactSha256",
  ])) return null
  if (value.provider !== "github"
    || typeof value.repository !== "string"
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || typeof value.url !== "string"
    || value.url !== `https://github.com/${value.repository}/pull/${value.number}`
    || value.baseCommit !== artifact.provenance.baseCommit
    || value.headBranch !== artifact.pullRequestPreview.headBranch
    || value.artifactSha256 !== artifact.patch.sha256) return null

  return {
    provider: "github",
    repository: value.repository,
    number: value.number as number,
    url: value.url,
    baseCommit: value.baseCommit,
    headBranch: value.headBranch,
    artifactSha256: value.artifactSha256,
  }
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
