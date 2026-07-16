import { randomUUID } from "node:crypto"

import type {
  BuildIncident,
  BuildIncidentRetry,
  BuildIncidentRetryErrorCode,
  BuildRemediationVerification,
  BuildRemediationVerificationErrorCode,
  BuildWorkflowRun,
  IncidentDelivery,
  IncidentRemediation,
  VerifiedBuildCiResult,
} from "@podo/contracts"
import { evaluateReaction } from "@podo/domain"
import type {
  GitHubActionsRetryRequest,
  GitHubActionsRetryResult,
  GitHubActionsRunBinding,
  GitHubActionsWorkflowRunListRequest,
} from "@podo/plugin-github"

import type { SettingsStore } from "../../settings"
import type { IncidentAuditStore } from "../audit/incident-audit"

export interface BuildIncidentSource {
  get(incidentId: string): BuildIncident | null
  list(): BuildIncident[]
  setRetry(incidentId: string, retry: BuildIncidentRetry): BuildIncident | null
  markRemediating(incidentId: string): BuildIncident | null
  markRemediationResolution(incidentId: string, status: "denied" | "failed"): BuildIncident | null
  setRemediationVerification(
    incidentId: string,
    verification: BuildRemediationVerification,
  ): BuildIncident | null
  setVerifiedCiResult(incidentId: string, result: VerifiedBuildCiResult): BuildIncident | null
}

export interface BuildIncidentActionsPort {
  retryFailedJobs(input: GitHubActionsRetryRequest): Promise<unknown>
  getCurrentRun(input: GitHubActionsRunBinding): Promise<unknown>
  listRunsForHead(input: GitHubActionsWorkflowRunListRequest): Promise<unknown>
}

export interface BuildIncidentRemediationReadPort {
  get(incidentId: string):
    | { ok: true; remediation: IncidentRemediation }
    | { ok: false; status: number; error: string; message: string }
}

export interface BuildIncidentDeliveryReadPort {
  get(incidentId: string):
    | { ok: true; delivery: IncidentDelivery }
    | { ok: false; status: number; error: string; message: string }
}

export interface BuildIncidentActionConfig {
  repository: { owner: string; name: string }
  operatorIdentity: string
  verificationTimeoutMs?: number
  now?: () => Date
  actions: BuildIncidentActionsPort
}

export type StartBuildIncidentRetryResult =
  | { ok: true; created: boolean; incident: BuildIncident; retry: BuildIncidentRetry }
  | { ok: false; status: 404; error: "not_found"; message: string }
  | { ok: false; status: 409; error: "diagnosis_not_validated" | "policy_denied" | "incident_already_resolved" | "resolution_in_progress"; message: string }

export type DecideBuildIncidentRetryResult =
  | { ok: true; incident: BuildIncident; retry: BuildIncidentRetry }
  | { ok: false; status: 404; error: "not_found" | "approval_not_found"; message: string }
  | { ok: false; status: 409; error: "approval_already_decided"; message: string }

export type GetBuildIncidentRetryResult =
  | { ok: true; incident: BuildIncident; retry: BuildIncidentRetry }
  | { ok: false; status: 404; error: "not_found"; message: string }

export type StartBuildRemediationVerificationResult =
  | { ok: true; created: boolean; incident: BuildIncident; verification: BuildRemediationVerification }
  | { ok: false; status: 404; error: "not_found"; message: string }
  | { ok: false; status: 409; error: "remediation_not_verified" | "delivery_not_verified" | "invalid_delivery_binding" | "incident_already_resolved" | "resolution_in_progress"; message: string }

export type GetBuildRemediationVerificationResult =
  | { ok: true; incident: BuildIncident; verification: BuildRemediationVerification }
  | { ok: false; status: 404; error: "not_found"; message: string }

interface RetryRecord {
  retryId: string
  approvalId: string
  authorization?: GitHubActionsRetryRequest["authorization"]
  dispatch?: Promise<void>
  observation?: Promise<void>
  lastObservation?: string
}

interface VerificationRecord {
  verificationId: string
  observation?: Promise<void>
  lastObservation?: string
}

interface RemediationAuditMarkers {
  requested?: string
  approval?: string
  tested?: string
  failure?: string
  deliveryRequested?: string
  deliveryApproval?: string
  delivered?: string
  deliveryFailure?: string
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 15 * 60_000

export class BuildIncidentActionService {
  private readonly retries = new Map<string, RetryRecord>()
  private readonly verifications = new Map<string, VerificationRecord>()
  private readonly remediationAudit = new Map<string, RemediationAuditMarkers>()
  private readonly now: () => Date
  private readonly verificationTimeoutMs: number
  private readonly expectedRepository: string

  constructor(
    private readonly config: BuildIncidentActionConfig,
    private readonly incidents: BuildIncidentSource,
    private readonly settings: SettingsStore,
    private readonly audit: IncidentAuditStore,
    private readonly remediations: BuildIncidentRemediationReadPort,
    private readonly deliveries: BuildIncidentDeliveryReadPort,
  ) {
    if (!isRepository(config.repository)
      || !isOperatorIdentity(config.operatorIdentity)
      || !config.actions
      || (config.verificationTimeoutMs !== undefined
        && (!Number.isSafeInteger(config.verificationTimeoutMs)
          || config.verificationTimeoutMs < 1_000
          || config.verificationTimeoutMs > 24 * 60 * 60_000))) {
      throw new Error("invalid_build_incident_action_config")
    }
    this.now = config.now ?? (() => new Date())
    this.verificationTimeoutMs = config.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS
    this.expectedRepository = `${config.repository.owner}/${config.repository.name}`
  }

  list(): BuildIncident[] {
    return this.incidents.list().map((incident) => {
      this.syncRemediation(incident.id)
      return this.current(incident.id)
    })
  }

  get(incidentId: string): BuildIncident | null {
    const incident = this.incidents.get(incidentId)
    if (!incident) return null
    this.syncRemediation(incidentId)
    return this.current(incidentId)
  }

  startRetry(incidentId: string): StartBuildIncidentRetryResult {
    const incident = this.incidents.get(incidentId)
    if (!incident) return notFound("Build incident was not found")
    if (incident.retry) {
      return {
        ok: true,
        created: false,
        incident,
        retry: copy(incident.retry),
      }
    }
    if (incident.remediationVerification?.status === "verified" || incident.ciResult) {
      return {
        ok: false,
        status: 409,
        error: "incident_already_resolved",
        message: "Build incident already has a verified CI result",
      }
    }
    if (incident.status === "remediating"
      || incident.remediationVerification?.status === "awaiting_ci_result") {
      return {
        ok: false,
        status: 409,
        error: "resolution_in_progress",
        message: "A remediation resolution is already in progress",
      }
    }
    if (!incident.diagnosis || incident.diagnosis.status !== "validated") {
      return {
        ok: false,
        status: 409,
        error: "diagnosis_not_validated",
        message: "A validated evidence-backed diagnosis is required before retry",
      }
    }

    const mode = this.settings.get().autonomyMode
    const policy = evaluateReaction({
      mode,
      action: "retry_ci",
      approval: "pending",
      regression: "not_run",
      target: "external_ci",
    })
    if (policy.allowed || policy.reason !== "approval_required" || !policy.requiresApproval) {
      return {
        ok: false,
        status: 409,
        error: "policy_denied",
        message: `Autonomy mode ${mode} does not permit approval-gated CI retry`,
      }
    }

    const now = this.timestamp()
    const retry: BuildIncidentRetry = {
      id: `build_retry_${randomUUID()}`,
      status: "pending_approval",
      approval: { id: `approval_${randomUUID()}`, status: "pending" },
      sourceRun: {
        id: incident.sourceRun.id,
        attempt: incident.sourceRun.attempt,
        headSha: incident.sourceRun.headSha,
      },
      createdAt: now,
      updatedAt: now,
    }
    if (!this.incidents.setRetry(incidentId, retry)) {
      throw new Error("build_incident_retry_state_rejected")
    }
    this.retries.set(incidentId, { retryId: retry.id, approvalId: retry.approval.id })
    this.audit.append(incidentId, {
      kind: "build.retry_requested",
      retryId: retry.id,
      approvalId: retry.approval.id,
    })
    return { ok: true, created: true, incident: this.current(incidentId), retry: copy(retry) }
  }

  async decideRetry(
    incidentId: string,
    approvalId: string,
    decision: "approve" | "deny",
  ): Promise<DecideBuildIncidentRetryResult> {
    const incident = this.incidents.get(incidentId)
    const record = this.retries.get(incidentId)
    if (!incident || !record || !incident.retry || incident.retry.id !== record.retryId) {
      return notFound("Build incident retry was not found")
    }
    let retry = copy(incident.retry)
    if (retry.approval.id !== approvalId || record.approvalId !== approvalId) {
      return { ok: false, status: 404, error: "approval_not_found", message: "Build retry approval was not found" }
    }

    const prior = retry.approval.status
    if (prior !== "pending") {
      if ((prior === "approved" && decision === "approve") || (prior === "denied" && decision === "deny")) {
        if (record.dispatch) await record.dispatch
        const current = this.current(incidentId)
        retry = copy(current.retry!)
        if (prior === "approved" && retry.status === "awaiting_ci_result") {
          await this.observeRetry(current, record, retry)
          retry = copy(this.current(incidentId).retry!)
        }
        return { ok: true, incident: this.current(incidentId), retry }
      }
      return {
        ok: false,
        status: 409,
        error: "approval_already_decided",
        message: "Build retry approval already has a different decision",
      }
    }

    retry.updatedAt = this.timestamp()
    retry.approval.status = decision === "approve" ? "approved" : "denied"
    this.audit.append(incidentId, {
      kind: "build.retry_approval_decided",
      retryId: retry.id,
      approvalId,
      decision,
      decidedBy: this.config.operatorIdentity,
    })
    if (decision === "deny") {
      retry.status = "denied"
      this.saveRetry(incidentId, retry)
      return { ok: true, incident: this.current(incidentId), retry: copy(retry) }
    }

    const policy = evaluateReaction({
      mode: this.settings.get().autonomyMode,
      action: "retry_ci",
      approval: "approved",
      regression: "not_run",
      target: "external_ci",
    })
    if (!policy.allowed) {
      this.failRetry(incidentId, retry, "policy_denied", "CI retry was denied by the active policy")
      return { ok: true, incident: this.current(incidentId), retry: copy(retry) }
    }

    record.authorization = {
      kind: "core.github_actions_retry.v1",
      decision: "approved",
      approvalId,
      approvedBy: this.config.operatorIdentity,
      approvedAt: retry.updatedAt,
    }
    retry.status = "dispatching"
    this.saveRetry(incidentId, retry)
    record.dispatch = this.dispatchRetry(this.current(incidentId), record, retry)
    await record.dispatch
    const current = this.current(incidentId)
    return { ok: true, incident: current, retry: copy(current.retry!) }
  }

  async getRetry(incidentId: string): Promise<GetBuildIncidentRetryResult> {
    const incident = this.incidents.get(incidentId)
    const record = this.retries.get(incidentId)
    if (!incident || !record || !incident.retry || incident.retry.id !== record.retryId) {
      return notFound("Build incident retry was not found")
    }
    if (record.dispatch) await record.dispatch
    const current = this.current(incidentId)
    if (current.retry?.status === "awaiting_ci_result") {
      await this.observeRetry(current, record, copy(current.retry))
    }
    const refreshed = this.current(incidentId)
    return { ok: true, incident: refreshed, retry: copy(refreshed.retry!) }
  }

  syncRemediation(incidentId: string): void {
    if (!this.incidents.get(incidentId)) return
    const remediationResult = this.remediations.get(incidentId)
    if (!remediationResult.ok) return
    const remediation = remediationResult.remediation
    const markers = this.remediationAudit.get(incidentId) ?? {}
    if (markers.requested !== remediation.id) {
      this.audit.append(incidentId, { kind: "build.remediation_requested", remediationId: remediation.id })
      markers.requested = remediation.id
      this.incidents.markRemediating(incidentId)
    }
    if (remediation.approval.status !== "pending") {
      const approvalKey = `${remediation.id}:${remediation.approval.id}:${remediation.approval.status}`
      if (markers.approval !== approvalKey) {
        this.audit.append(incidentId, {
          kind: "build.remediation_approval_decided",
          remediationId: remediation.id,
          approvalId: remediation.approval.id,
          decision: remediation.approval.status === "approved" ? "approve" : "deny",
          decidedBy: this.config.operatorIdentity,
        })
        markers.approval = approvalKey
      }
    }
    if (remediation.status === "completed" && remediation.artifact) {
      const artifactId = remediation.artifact.pullRequestPreview.id
      const testedKey = `${remediation.id}:${artifactId}`
      if (markers.tested !== testedKey) {
        this.audit.append(incidentId, { kind: "build.remediation_tested", remediationId: remediation.id, artifactId })
        markers.tested = testedKey
      }
    }
    if (remediation.status === "failed" && remediation.error) {
      const failureKey = `${remediation.id}:${remediation.error.code}`
      if (markers.failure !== failureKey) {
        this.audit.append(incidentId, {
          kind: "build.remediation_failed",
          remediationId: remediation.id,
          code: remediation.error.code,
        })
        markers.failure = failureKey
      }
      this.incidents.markRemediationResolution(incidentId, "failed")
    } else if (remediation.status === "denied") {
      this.incidents.markRemediationResolution(incidentId, "denied")
    }
    const deliveryResult = this.deliveries.get(incidentId)
    if (deliveryResult.ok) {
      const delivery = deliveryResult.delivery
      const requestedKey = `${delivery.id}:${delivery.remediationId}:${delivery.artifactId}:${delivery.approval.id}`
      if (markers.deliveryRequested !== requestedKey) {
        this.audit.append(incidentId, {
          kind: "build.delivery_requested",
          deliveryId: delivery.id,
          remediationId: delivery.remediationId,
          artifactId: delivery.artifactId,
          approvalId: delivery.approval.id,
        })
        markers.deliveryRequested = requestedKey
      }
      if (delivery.approval.status !== "pending") {
        const approvalKey = `${delivery.id}:${delivery.approval.id}:${delivery.approval.status}`
        if (markers.deliveryApproval !== approvalKey) {
          this.audit.append(incidentId, {
            kind: "build.delivery_approval_decided",
            deliveryId: delivery.id,
            approvalId: delivery.approval.id,
            decision: delivery.approval.status === "approved" ? "approve" : "deny",
            decidedBy: this.config.operatorIdentity,
          })
          markers.deliveryApproval = approvalKey
        }
      }
      if (delivery.status === "failed" && delivery.error) {
        const failureKey = `${delivery.id}:${delivery.error.code}`
        if (markers.deliveryFailure !== failureKey) {
          this.audit.append(incidentId, {
            kind: "build.delivery_failed",
            deliveryId: delivery.id,
            code: delivery.error.code,
          })
          markers.deliveryFailure = failureKey
        }
        this.incidents.markRemediationResolution(incidentId, "failed")
      } else if (delivery.status === "denied") {
        this.incidents.markRemediationResolution(incidentId, "denied")
      } else if (delivery.status === "delivered" && delivery.pullRequest) {
        const pullRequest = delivery.pullRequest
        const proof = pullRequest.proof
        if (isCommitSha(pullRequest.headSha)
          && proof
          && proof.authorization.approvalId === delivery.approval.id
          && proof.authorization.approvedBy === this.config.operatorIdentity) {
          const deliveredKey = `${delivery.id}:${delivery.artifactId}:${pullRequest.headSha}`
          if (markers.delivered !== deliveredKey) {
            this.audit.append(incidentId, {
              kind: "build.remediation_delivered",
              deliveryId: delivery.id,
              remediationId: delivery.remediationId,
              artifactId: delivery.artifactId,
              approvalId: proof.authorization.approvalId,
              approvedBy: proof.authorization.approvedBy,
              approvedAt: proof.authorization.approvedAt,
              provider: pullRequest.provider,
              repository: pullRequest.repository,
              pullRequestNumber: pullRequest.number,
              pullRequestUrl: pullRequest.url,
              providerStatus: proof.providerStatus,
              idempotencyKey: proof.idempotencyKey,
              baseCommit: pullRequest.baseCommit,
              baseBranch: pullRequest.baseBranch,
              headBranch: pullRequest.headBranch,
              headSha: pullRequest.headSha,
              resultTreeOid: proof.resultTreeOid,
              patchSha256: proof.patchSha256,
              validationChecks: [...proof.validationChecks],
              evidenceIds: [...proof.evidenceIds],
            })
            markers.delivered = deliveredKey
          }
        }
      }
    }
    this.remediationAudit.set(incidentId, markers)
  }

  async startRemediationVerification(
    incidentId: string,
  ): Promise<StartBuildRemediationVerificationResult> {
    const incident = this.incidents.get(incidentId)
    if (!incident) return notFound("Build incident was not found")
    this.syncRemediation(incidentId)
    const existing = this.verifications.get(incidentId)
    const currentIncident = this.current(incidentId)
    if (existing && currentIncident.remediationVerification?.id === existing.verificationId) {
      let verification = copy(currentIncident.remediationVerification)
      if (verification.status === "awaiting_ci_result") {
        await this.observeRemediation(currentIncident, existing, verification)
        verification = copy(this.current(incidentId).remediationVerification!)
      }
      return {
        ok: true,
        created: false,
        incident: this.current(incidentId),
        verification,
      }
    }
    if (currentIncident.retry?.status === "verified" || currentIncident.ciResult) {
      return {
        ok: false,
        status: 409,
        error: "incident_already_resolved",
        message: "Build incident already has a verified CI result",
      }
    }
    if (currentIncident.retry
      && currentIncident.retry.status !== "denied"
      && currentIncident.retry.status !== "failed") {
      return {
        ok: false,
        status: 409,
        error: "resolution_in_progress",
        message: "A CI retry resolution is already in progress",
      }
    }

    const remediationResult = this.remediations.get(incidentId)
    if (!remediationResult.ok
      || remediationResult.remediation.status !== "completed"
      || !remediationResult.remediation.artifact
      || remediationResult.remediation.artifact.regression.prePatch !== "failed"
      || remediationResult.remediation.artifact.regression.postPatch !== "passed"
      || remediationResult.remediation.artifact.validation.status !== "passed") {
      return {
        ok: false,
        status: 409,
        error: "remediation_not_verified",
        message: "A red-green tested remediation artifact is required",
      }
    }
    const remediation = remediationResult.remediation
    const artifact = remediation.artifact
    if (!artifact) throw new Error("verified_remediation_artifact_missing")
    const deliveryResult = this.deliveries.get(incidentId)
    if (!deliveryResult.ok
      || deliveryResult.delivery.status !== "delivered"
      || !deliveryResult.delivery.pullRequest) {
      return {
        ok: false,
        status: 409,
        error: "delivery_not_verified",
        message: "A delivered pull request is required before CI verification",
      }
    }
    const delivery = deliveryResult.delivery
    const pullRequest = delivery.pullRequest
    if (!pullRequest) throw new Error("verified_delivery_pull_request_missing")
    const proof = pullRequest.proof
    if (incident.repository !== this.expectedRepository
      || remediation.incidentId !== incident.id
      || artifact.provenance.baseCommit !== incident.sourceRun.headSha
      || !isCommitSha(artifact.provenance.resultTreeOid)
      || !equalStrings(artifact.evidenceIds, incident.diagnosis?.status === "validated" ? incident.diagnosis.evidenceIds : [])
      || delivery.incidentId !== incident.id
      || delivery.remediationId !== remediation.id
      || delivery.artifactId !== artifact.pullRequestPreview.id
      || pullRequest.repository !== incident.repository
      || pullRequest.baseCommit !== artifact.provenance.baseCommit
      || pullRequest.baseBranch !== artifact.pullRequestPreview.baseBranch
      || pullRequest.headBranch !== artifact.pullRequestPreview.headBranch
      || pullRequest.artifactId !== artifact.pullRequestPreview.id
      || !isCommitSha(pullRequest.headSha)
      || pullRequest.headSha === incident.sourceRun.headSha
      || !proof
      || proof.idempotencyKey !== delivery.id
      || proof.resultTreeOid !== artifact.provenance.resultTreeOid
      || proof.patchSha256 !== artifact.patch.sha256
      || !equalStrings(proof.validationChecks, artifact.validation.checks)
      || !equalStrings(proof.evidenceIds, artifact.evidenceIds)
      || proof.authorization.approvalId !== delivery.approval.id
      || proof.authorization.approvedBy !== this.config.operatorIdentity) {
      return {
        ok: false,
        status: 409,
        error: "invalid_delivery_binding",
        message: "Delivered pull request does not match the tested remediation artifact",
      }
    }

    const now = this.timestamp()
    const verification: BuildRemediationVerification = {
      id: `build_verification_${randomUUID()}`,
      status: "awaiting_ci_result",
      repository: incident.repository,
      workflowId: incident.workflow.id,
      remediationId: remediation.id,
      artifactId: artifact.pullRequestPreview.id,
      resultTreeOid: artifact.provenance.resultTreeOid,
      headBranch: artifact.pullRequestPreview.headBranch,
      headSha: pullRequest.headSha,
      createdAt: now,
      updatedAt: now,
    }
    if (!this.incidents.setRemediationVerification(incidentId, verification)) {
      throw new Error("build_remediation_verification_state_rejected")
    }
    const record: VerificationRecord = { verificationId: verification.id }
    this.verifications.set(incidentId, record)
    this.audit.append(incidentId, {
      kind: "build.remediation_ci_verification_started",
      verificationId: verification.id,
      remediationId: verification.remediationId,
      artifactId: verification.artifactId,
      resultTreeOid: verification.resultTreeOid,
      headBranch: verification.headBranch,
      headSha: verification.headSha,
    })
    await this.observeRemediation(this.current(incidentId), record, verification)
    const refreshed = this.current(incidentId)
    return {
      ok: true,
      created: true,
      incident: refreshed,
      verification: copy(refreshed.remediationVerification!),
    }
  }

  async getRemediationVerification(
    incidentId: string,
  ): Promise<GetBuildRemediationVerificationResult> {
    const incident = this.incidents.get(incidentId)
    const record = this.verifications.get(incidentId)
    if (!incident || !record || !incident.remediationVerification
      || incident.remediationVerification.id !== record.verificationId) {
      return notFound("Build remediation verification was not found")
    }
    if (incident.remediationVerification.status === "awaiting_ci_result") {
      await this.observeRemediation(incident, record, copy(incident.remediationVerification))
    }
    const refreshed = this.current(incidentId)
    return {
      ok: true,
      incident: refreshed,
      verification: copy(refreshed.remediationVerification!),
    }
  }

  private async dispatchRetry(
    incident: BuildIncident,
    record: RetryRecord,
    retry: BuildIncidentRetry,
  ): Promise<void> {
    if (!record.authorization) {
      this.failRetry(incident.id, retry, "policy_denied", "CI retry authorization was unavailable")
      return
    }
    const request: GitHubActionsRetryRequest = {
      authorization: copy(record.authorization),
      incidentId: incident.id,
      idempotencyKey: retry.id,
      repository: copy(this.config.repository),
      run: {
        id: incident.sourceRun.id,
        headSha: incident.sourceRun.headSha,
        attempt: incident.sourceRun.attempt,
      },
    }
    this.audit.append(incident.id, {
      kind: "build.retry_dispatch_attempted",
      retryId: retry.id,
      approvalId: request.authorization.approvalId,
      approvedBy: request.authorization.approvedBy,
      approvedAt: request.authorization.approvedAt,
      repository: incident.repository,
      idempotencyKey: retry.id,
      runId: incident.sourceRun.id,
      headSha: incident.sourceRun.headSha,
      previousAttempt: incident.sourceRun.attempt,
    })
    let raw: unknown
    try {
      raw = await this.config.actions.retryFailedJobs(request)
    } catch {
      this.failRetry(incident.id, retry, "retry_failed", "GitHub Actions retry failed")
      return
    }
    if (!isRetryResult(raw, request)) {
      this.failRetry(incident.id, retry, "invalid_retry_result", "GitHub Actions retry returned an invalid result")
      return
    }
    retry.status = "awaiting_ci_result"
    retry.updatedAt = this.timestamp()
    this.saveRetry(incident.id, retry)
    this.audit.append(incident.id, {
      kind: "build.retry_dispatched",
      retryId: retry.id,
      approvalId: request.authorization.approvalId,
      approvedBy: request.authorization.approvedBy,
      approvedAt: request.authorization.approvedAt,
      providerStatus: raw.status,
      repository: incident.repository,
      idempotencyKey: retry.id,
      runId: incident.sourceRun.id,
      headSha: incident.sourceRun.headSha,
      previousAttempt: incident.sourceRun.attempt,
      expectedRunAttempt: incident.sourceRun.attempt + 1,
    })
    await this.observeRetry(this.current(incident.id), record, retry)
  }

  private observeRetry(
    incident: BuildIncident,
    record: RetryRecord,
    retry: BuildIncidentRetry,
  ): Promise<void> {
    if (record.observation) return record.observation
    const operation = this.refreshRetry(incident, record, retry)
    record.observation = operation
    void operation.finally(() => {
      if (record.observation === operation) delete record.observation
    }).catch(() => undefined)
    return operation
  }

  private async refreshRetry(
    incident: BuildIncident,
    record: RetryRecord,
    retry: BuildIncidentRetry,
  ): Promise<void> {
    // Approval can remain pending for an arbitrary amount of time. The CI
    // observation window starts only after GitHub accepts the retry, when the
    // retry enters awaiting_ci_result and updatedAt is refreshed.
    if (this.hasTimedOut(retry.updatedAt)) {
      this.failRetry(incident.id, retry, "verification_timeout", "Timed out waiting for the retried CI result")
      return
    }
    let raw: unknown
    try {
      raw = await this.config.actions.getCurrentRun({
        repository: copy(this.config.repository),
        runId: incident.sourceRun.id,
        headSha: incident.sourceRun.headSha,
      })
    } catch {
      this.failRetry(incident.id, retry, "retry_failed", "GitHub Actions retry result could not be read")
      return
    }
    const run = parseRun(raw)
    const expectedAttempt = incident.sourceRun.attempt + 1
    if (!run
      || run.id !== incident.sourceRun.id
      || run.workflowId !== incident.workflow.id
      || run.workflowName !== incident.workflow.name
      || run.workflowPath !== incident.workflow.path
      || run.headSha !== incident.sourceRun.headSha
      || run.headBranch !== incident.sourceRun.headBranch) {
      this.failRetry(incident.id, retry, "ci_result_mismatch", "Observed CI result did not match the approved retry")
      return
    }
    if (!isCoherentRun(run) || !isGitHubRunUrl(run.url, incident.repository, run.id)) {
      this.failRetry(incident.id, retry, "ci_result_mismatch", "Observed CI result did not match the approved retry")
      return
    }
    // GitHub can briefly return the completed source attempt after accepting
    // the retry. It is neither evidence of the retried result nor a mismatch;
    // keep polling until the exact next attempt becomes visible. Skipped or
    // otherwise unexpected attempts still fail closed.
    if (run.attempt === incident.sourceRun.attempt) return
    if (run.attempt !== expectedAttempt) {
      this.failRetry(incident.id, retry, "ci_result_mismatch", "Observed CI result did not match the approved retry")
      return
    }
    this.auditRetryObservation(incident.id, record, retry, run)
    if (run.status !== "completed") return
    if (run.conclusion !== "success") {
      this.failRetry(incident.id, retry, "ci_failed", "The retried CI run did not pass")
      return
    }
    const result: VerifiedBuildCiResult & { mode: "retry" } = {
      provider: "github_actions",
      mode: "retry",
      repository: incident.repository,
      workflowId: run.workflowId,
      runId: run.id,
      runAttempt: run.attempt,
      headSha: run.headSha,
      status: "completed",
      conclusion: "success",
      url: run.url,
      verifiedAt: this.timestamp(),
    }
    retry.status = "verified"
    retry.result = result
    delete retry.error
    retry.updatedAt = result.verifiedAt
    this.saveRetry(incident.id, retry)
    this.audit.append(incident.id, {
      kind: "build.retry_verified",
      retryId: retry.id,
      runId: run.id,
      runAttempt: run.attempt,
    })
  }

  private async refreshRemediation(
    incident: BuildIncident,
    record: VerificationRecord,
    verification: BuildRemediationVerification,
  ): Promise<void> {
    if (this.hasTimedOut(verification.createdAt)) {
      this.failRemediation(incident.id, verification, "verification_timeout", "Timed out waiting for remediation CI")
      return
    }
    let raw: unknown
    try {
      raw = await this.config.actions.listRunsForHead({
        repository: copy(this.config.repository),
        headSha: verification.headSha,
      })
    } catch {
      this.failRemediation(incident.id, verification, "ci_result_mismatch", "Remediation CI result could not be read")
      return
    }
    const list = parseRunList(raw, this.config.repository, verification.headSha)
    if (!list) {
      this.failRemediation(incident.id, verification, "ci_result_mismatch", "Observed CI results did not match the delivered remediation")
      return
    }
    const candidates = list.filter((run) => run.workflowId === verification.workflowId)
    if (candidates.some((run) => run.headBranch !== verification.headBranch)) {
      this.failRemediation(incident.id, verification, "ci_result_mismatch", "Observed CI branch did not match the delivered remediation")
      return
    }
    const run = candidates.sort(compareRuns).at(-1)
    if (!run) return
    if (run.workflowName !== incident.workflow.name
      || run.workflowPath !== incident.workflow.path
      || !isCoherentRun(run)
      || !isGitHubRunUrl(run.url, incident.repository, run.id)) {
      this.failRemediation(incident.id, verification, "ci_result_mismatch", "Observed CI result did not match the delivered remediation")
      return
    }
    this.auditRemediationObservation(incident.id, record, verification, run)
    if (run.status !== "completed") return
    if (run.conclusion !== "success") {
      this.failRemediation(incident.id, verification, "ci_failed", "CI did not pass for the delivered remediation")
      return
    }
    const result: VerifiedBuildCiResult & { mode: "remediation"; artifactId: string } = {
      provider: "github_actions",
      mode: "remediation",
      repository: incident.repository,
      workflowId: run.workflowId,
      runId: run.id,
      runAttempt: run.attempt,
      headSha: run.headSha,
      status: "completed",
      conclusion: "success",
      url: run.url,
      verifiedAt: this.timestamp(),
      artifactId: verification.artifactId,
    }
    verification.status = "verified"
    verification.result = result
    delete verification.error
    verification.updatedAt = result.verifiedAt
    this.saveVerification(incident.id, verification)
    this.incidents.setVerifiedCiResult(incident.id, result)
    this.audit.append(incident.id, {
      kind: "build.remediation_verified",
      verificationId: verification.id,
      remediationId: verification.remediationId,
      artifactId: verification.artifactId,
      runId: run.id,
      runAttempt: run.attempt,
      headSha: run.headSha,
    })
  }

  private observeRemediation(
    incident: BuildIncident,
    record: VerificationRecord,
    verification: BuildRemediationVerification,
  ): Promise<void> {
    if (record.observation) return record.observation
    const operation = this.refreshRemediation(incident, record, verification)
    record.observation = operation
    void operation.finally(() => {
      if (record.observation === operation) delete record.observation
    }).catch(() => undefined)
    return operation
  }

  private auditRetryObservation(
    incidentId: string,
    record: RetryRecord,
    retry: BuildIncidentRetry,
    run: BuildWorkflowRun,
  ): void {
    const key = observationKey(run)
    if (record.lastObservation === key) return
    record.lastObservation = key
    this.audit.append(incidentId, {
      kind: "build.retry_ci_result_observed",
      retryId: retry.id,
      runId: run.id,
      runAttempt: run.attempt,
      headSha: run.headSha,
      status: run.status,
      conclusion: run.conclusion,
    })
  }

  private auditRemediationObservation(
    incidentId: string,
    record: VerificationRecord,
    verification: BuildRemediationVerification,
    run: BuildWorkflowRun,
  ): void {
    const key = observationKey(run)
    if (record.lastObservation === key) return
    record.lastObservation = key
    this.audit.append(incidentId, {
      kind: "build.remediation_ci_result_observed",
      verificationId: verification.id,
      runId: run.id,
      runAttempt: run.attempt,
      headSha: run.headSha,
      status: run.status,
      conclusion: run.conclusion,
    })
  }

  private failRetry(
    incidentId: string,
    retry: BuildIncidentRetry,
    code: BuildIncidentRetryErrorCode,
    message: string,
  ): void {
    if (retry.status === "failed" && retry.error?.code === code) return
    retry.status = "failed"
    retry.updatedAt = this.timestamp()
    delete retry.result
    retry.error = { code, message }
    this.saveRetry(incidentId, retry)
    this.audit.append(incidentId, { kind: "build.retry_failed", retryId: retry.id, code })
  }

  private failRemediation(
    incidentId: string,
    verification: BuildRemediationVerification,
    code: BuildRemediationVerificationErrorCode,
    message: string,
  ): void {
    if (verification.status === "failed" && verification.error?.code === code) return
    verification.status = "failed"
    verification.updatedAt = this.timestamp()
    delete verification.result
    verification.error = { code, message }
    this.saveVerification(incidentId, verification)
    this.audit.append(incidentId, { kind: "build.remediation_ci_failed", verificationId: verification.id, code })
  }

  private saveRetry(incidentId: string, retry: BuildIncidentRetry): void {
    if (!this.incidents.setRetry(incidentId, retry)) {
      throw new Error("build_incident_retry_state_rejected")
    }
  }

  private saveVerification(incidentId: string, verification: BuildRemediationVerification): void {
    if (!this.incidents.setRemediationVerification(incidentId, verification)) {
      throw new Error("build_remediation_verification_state_rejected")
    }
  }

  private current(incidentId: string): BuildIncident {
    const incident = this.incidents.get(incidentId)
    if (!incident) throw new Error("build_incident_state_missing")
    return incident
  }

  private hasTimedOut(createdAt: string): boolean {
    const created = Date.parse(createdAt)
    return !Number.isFinite(created) || this.now().getTime() - created >= this.verificationTimeoutMs
  }

  private timestamp(): string {
    const value = this.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("invalid_build_incident_clock")
    return value.toISOString()
  }
}

function parseRun(value: unknown): BuildWorkflowRun | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id",
    "workflowId",
    "workflowName",
    "workflowPath",
    "runNumber",
    "attempt",
    "event",
    "headBranch",
    "headSha",
    "status",
    "conclusion",
    "createdAt",
    "updatedAt",
    "url",
  ])) return null
  if (!isPositiveInteger(value.id)
    || !isPositiveInteger(value.workflowId)
    || !isIdentifier(value.workflowName)
    || !isIdentifier(value.workflowPath)
    || !isPositiveInteger(value.runNumber)
    || !isPositiveInteger(value.attempt)
    || !isIdentifier(value.event)
    || (value.headBranch !== null && !isIdentifier(value.headBranch))
    || !isCommitSha(value.headSha)
    || !isBuildStatus(value.status)
    || !isBuildConclusion(value.conclusion)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !isIdentifier(value.url)) return null
  return copy(value as unknown as BuildWorkflowRun)
}

function parseRunList(
  value: unknown,
  repository: { owner: string; name: string },
  headSha: string,
): BuildWorkflowRun[] | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ["repository", "headSha", "runs"])
    || !sameRepository(value.repository, repository)
    || value.headSha !== headSha
    || !Array.isArray(value.runs)
    || value.runs.length > 1_000) return null
  const runs: BuildWorkflowRun[] = []
  for (const raw of value.runs) {
    const run = parseRun(raw)
    if (!run || run.headSha !== headSha) return null
    runs.push(run)
  }
  if (new Set(runs.map(({ id }) => id)).size !== runs.length) return null
  return runs
}

function isRetryResult(value: unknown, request: GitHubActionsRetryRequest): value is GitHubActionsRetryResult {
  return isRecord(value)
    && hasExactKeys(value, ["status", "repository", "incidentId", "idempotencyKey", "run", "authorization"])
    && (value.status === "accepted" || value.status === "existing")
    && sameRepository(value.repository, request.repository)
    && value.incidentId === request.incidentId
    && value.idempotencyKey === request.idempotencyKey
    && isRecord(value.run)
    && hasExactKeys(value.run, ["id", "headSha", "previousAttempt"])
    && value.run.id === request.run.id
    && value.run.headSha === request.run.headSha
    && value.run.previousAttempt === request.run.attempt
    && isRecord(value.authorization)
    && hasExactKeys(value.authorization, ["approvalId", "approvedBy", "approvedAt"])
    && value.authorization.approvalId === request.authorization.approvalId
    && value.authorization.approvedBy === request.authorization.approvedBy
    && value.authorization.approvedAt === request.authorization.approvedAt
}

function compareRuns(left: BuildWorkflowRun, right: BuildWorkflowRun): number {
  return left.createdAt.localeCompare(right.createdAt)
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.runNumber - right.runNumber
    || left.attempt - right.attempt
    || left.id - right.id
}

function observationKey(run: BuildWorkflowRun): string {
  return `${run.id}:${run.attempt}:${run.headSha}:${run.status}:${run.conclusion ?? "null"}:${run.updatedAt}`
}

function sameRepository(value: unknown, expected: { owner: string; name: string }): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["owner", "name"])
    && value.owner === expected.owner
    && value.name === expected.name
}

function isRepository(value: unknown): value is { owner: string; name: string } {
  return isRecord(value)
    && hasExactKeys(value, ["owner", "name"])
    && typeof value.owner === "string"
    && /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38})$/.test(value.owner)
    && typeof value.name === "string"
    && /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/.test(value.name)
    && value.owner !== ".."
    && value.name !== ".."
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const leftValues = new Set(left)
  const rightValues = new Set(right)
  return leftValues.size === left.length
    && rightValues.size === right.length
    && leftValues.size === rightValues.size
    && [...leftValues].every((value) => rightValues.has(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4_096
    && value === value.trim()
    && !value.includes("\0")
}

function isOperatorIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 320
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value)
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isCoherentRun(run: BuildWorkflowRun): boolean {
  return run.updatedAt >= run.createdAt
    && (run.status === "completed" ? run.conclusion !== null : run.conclusion === null)
}

function isGitHubRunUrl(value: string, repository: string, runId: number): boolean {
  return value === `https://github.com/${repository}/actions/runs/${runId}`
}

function isBuildStatus(value: unknown): value is BuildWorkflowRun["status"] {
  return typeof value === "string"
    && ["requested", "queued", "pending", "waiting", "in_progress", "completed"].includes(value)
}

function isBuildConclusion(value: unknown): value is BuildWorkflowRun["conclusion"] {
  return value === null || (typeof value === "string"
    && ["action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out"].includes(value))
}

function notFound(message: string): { ok: false; status: 404; error: "not_found"; message: string } {
  return { ok: false, status: 404, error: "not_found", message }
}

function copy<T>(value: T): T {
  return structuredClone(value)
}
