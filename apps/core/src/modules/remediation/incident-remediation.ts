import { createHash, randomUUID } from "node:crypto"
import type {
  IncidentRemediation,
  IncidentRemediationAuditEvent,
  IncidentRemediationArtifact,
  ValidatedIncidentDiagnosis,
} from "@podo/contracts"
import { buildRemediatorPrompt, evaluateReaction, type PromptPolicy, type RemediatorTool } from "@podo/domain"
import type { SettingsStore } from "../../settings"
import type { IncidentMonitor } from "../incidents/incident-monitor"
import type { IncidentInvestigationCoordinator } from "../investigation/incident-investigation"

export interface IncidentRemediationExecutorInput {
  incident: {
    id: string
    affectedService: string
    deploymentId: string
    evidenceIds: string[]
    diagnosis: ValidatedIncidentDiagnosis
  }
  target: "isolated_checkout"
  policy: PromptPolicy<RemediatorTool>
}

export interface IncidentRemediationExecutorResult {
  patch: {
    summary: string
    changedFiles: string[]
    unifiedDiff: string
  }
  regression: {
    test: string
    prePatch: "failed" | "passed" | "not_run"
    postPatch: "failed" | "passed" | "not_run"
  }
  validation: {
    status: "passed" | "failed"
    checks: string[]
  }
  pullRequestPreview: {
    title: string
    body: string
    baseBranch: string
    headBranch: string
  }
}

export interface IncidentRemediationExecutor {
  execute(input: IncidentRemediationExecutorInput): Promise<unknown>
}

export type StartIncidentRemediationResult =
  | { ok: true; created: boolean; remediation: IncidentRemediation }
  | { ok: false; status: 404; error: "not_found"; message: string }
  | { ok: false; status: 409; error: "diagnosis_not_validated" | "policy_denied"; message: string }
  | { ok: false; status: 422; error: "remediation_not_safe"; message: string }
  | { ok: false; status: 503; error: "executor_unavailable"; message: string }

export type GetIncidentRemediationResult =
  | { ok: true; remediation: IncidentRemediation }
  | { ok: false; status: 404; error: "not_found"; message: string }

export type DecideIncidentRemediationResult =
  | { ok: true; remediation: IncidentRemediation }
  | { ok: false; status: 404; error: "not_found" | "approval_not_found"; message: string }
  | { ok: false; status: 409; error: "approval_already_decided"; message: string }

interface RemediationRecord {
  remediation: IncidentRemediation
  diagnosis: ValidatedIncidentDiagnosis
  audit: IncidentRemediationAuditEvent[]
  execution?: Promise<void>
}

type RemediationAuditInput = IncidentRemediationAuditEvent extends infer Event
  ? Event extends IncidentRemediationAuditEvent
    ? Omit<Event, "sequence" | "occurredAt" | "incidentId" | "remediationId">
    : never
  : never

const target = "isolated_checkout" as const

export class IncidentRemediationService {
  private readonly byIncident = new Map<string, RemediationRecord>()

  constructor(
    private readonly incidents: IncidentMonitor,
    private readonly investigations: IncidentInvestigationCoordinator,
    private readonly settings: SettingsStore,
    private readonly executor?: IncidentRemediationExecutor,
  ) {}

  start(incidentId: string): StartIncidentRemediationResult {
    const existing = this.byIncident.get(incidentId)
    if (existing) return { ok: true, created: false, remediation: copy(existing.remediation) }

    const incident = this.incidents.getIncident(incidentId)
    if (!incident) return { ok: false, status: 404, error: "not_found", message: "Incident was not found" }

    const diagnosis = this.investigations.publicIncident(incident).diagnosis
    if (!diagnosis || diagnosis.status !== "validated") {
      return { ok: false, status: 409, error: "diagnosis_not_validated", message: "A validated authoritative diagnosis is required" }
    }
    if (!diagnosis.safeToAttemptFix) {
      return { ok: false, status: 422, error: "remediation_not_safe", message: "The authoritative diagnosis does not permit a remediation attempt" }
    }
    if (!this.executor) {
      return { ok: false, status: 503, error: "executor_unavailable", message: "The remediation executor is unavailable" }
    }

    const mode = this.settings.get().autonomyMode
    const decision = evaluateReaction({
      mode,
      action: "start_codex",
      approval: "pending",
      regression: "not_run",
      target,
    })
    if (decision.allowed || decision.reason !== "approval_required" || !decision.requiresApproval) {
      return {
        ok: false,
        status: 409,
        error: "policy_denied",
        message: `Autonomy mode ${mode} does not allow approval-gated remediation: ${decision.reason}`,
      }
    }

    const now = new Date().toISOString()
    const record: RemediationRecord = {
      diagnosis: copy(diagnosis),
      audit: [],
      remediation: {
        id: `remediation_${randomUUID()}`,
        incidentId,
        status: "pending_approval",
        target,
        approval: { id: `approval_${randomUUID()}`, status: "pending" },
        createdAt: now,
        updatedAt: now,
      },
    }
    this.recordAudit(record, { kind: "remediation.requested" })
    this.byIncident.set(incidentId, record)
    return { ok: true, created: true, remediation: copy(record.remediation) }
  }

  get(incidentId: string): GetIncidentRemediationResult {
    const record = this.byIncident.get(incidentId)
    return record
      ? { ok: true, remediation: copy(record.remediation) }
      : { ok: false, status: 404, error: "not_found", message: "Incident remediation was not found" }
  }

  audit(incidentId: string): { ok: true; events: IncidentRemediationAuditEvent[] } | { ok: false } {
    const record = this.byIncident.get(incidentId)
    return record ? { ok: true, events: copy(record.audit) } : { ok: false }
  }

  async decide(
    incidentId: string,
    approvalId: string,
    decision: "approve" | "deny",
  ): Promise<DecideIncidentRemediationResult> {
    const record = this.byIncident.get(incidentId)
    if (!record) return { ok: false, status: 404, error: "not_found", message: "Incident remediation was not found" }
    if (record.remediation.approval.id !== approvalId) {
      return { ok: false, status: 404, error: "approval_not_found", message: "Remediation approval was not found" }
    }

    const decided = record.remediation.approval.status
    if (decided !== "pending") {
      if ((decided === "approved" && decision === "approve") || (decided === "denied" && decision === "deny")) {
        if (record.execution) await record.execution
        return { ok: true, remediation: copy(record.remediation) }
      }
      return { ok: false, status: 409, error: "approval_already_decided", message: "Remediation approval already has a different decision" }
    }

    record.remediation.updatedAt = new Date().toISOString()
    if (decision === "deny") {
      record.remediation.approval.status = "denied"
      record.remediation.status = "denied"
      this.recordAudit(record, { kind: "remediation.approval_decided", approvalId, decision })
      return { ok: true, remediation: copy(record.remediation) }
    }

    record.remediation.approval.status = "approved"
    record.remediation.status = "running"
    this.recordAudit(record, { kind: "remediation.approval_decided", approvalId, decision })
    record.execution = this.execute(record)
    await record.execution
    return { ok: true, remediation: copy(record.remediation) }
  }

  private async execute(record: RemediationRecord): Promise<void> {
    this.recordAudit(record, { kind: "remediation.execution_started" })
    const mode = this.settings.get().autonomyMode
    const executionDecision = evaluateReaction({
      mode,
      action: "start_codex",
      approval: "approved",
      regression: "not_run",
      target,
    })
    if (!executionDecision.allowed || !this.executor) {
      this.fail(record, "policy_denied", "Remediation execution was denied by the active policy")
      return
    }

    const incident = this.incidents.getIncident(record.remediation.incidentId)
    if (!incident) {
      this.fail(record, "policy_denied", "The authoritative incident is no longer available")
      return
    }

    let raw: unknown
    try {
      raw = await this.executor.execute({
        incident: {
          id: incident.id,
          affectedService: incident.affectedService,
          deploymentId: incident.deploymentId,
          evidenceIds: [...record.diagnosis.evidenceIds],
          diagnosis: copy(record.diagnosis),
        },
        target,
        policy: buildRemediatorPrompt({ mode, approval: "approved", regression: "not_run", target }),
      })
    } catch {
      this.fail(record, "execution_failed", "The remediation executor failed")
      return
    }

    const parsed = parseExecutorResult(raw)
    if (!parsed.ok) {
      this.fail(record, parsed.code, parsed.message)
      return
    }

    const releaseDecision = evaluateReaction({
      mode: this.settings.get().autonomyMode,
      action: "create_pull_request",
      approval: "approved",
      regression: "passed",
      target,
    })
    if (!releaseDecision.allowed) {
      this.fail(record, "policy_denied", "Pull request preview was denied by the active policy")
      return
    }

    record.remediation.artifact = toPublicArtifact(parsed.value)
    record.remediation.status = "completed"
    record.remediation.updatedAt = new Date().toISOString()
    this.recordAudit(record, {
      kind: "remediation.verification_succeeded",
      artifactSha256: record.remediation.artifact.patch.sha256,
    })
  }

  private fail(record: RemediationRecord, code: NonNullable<IncidentRemediation["error"]>["code"], message: string): void {
    record.remediation.status = "failed"
    record.remediation.updatedAt = new Date().toISOString()
    delete record.remediation.artifact
    record.remediation.error = { code, message }
    this.recordAudit(record, { kind: "remediation.verification_failed", code })
  }

  private recordAudit(
    record: RemediationRecord,
    event: RemediationAuditInput,
  ): void {
    const base = {
      sequence: record.audit.length + 1,
      occurredAt: new Date().toISOString(),
      incidentId: record.remediation.incidentId,
      remediationId: record.remediation.id,
    }
    switch (event.kind) {
      case "remediation.requested":
      case "remediation.execution_started":
        record.audit.push({ ...base, kind: event.kind })
        return
      case "remediation.approval_decided":
        record.audit.push({ ...base, kind: event.kind, approvalId: event.approvalId, decision: event.decision })
        return
      case "remediation.verification_failed":
        record.audit.push({ ...base, kind: event.kind, code: event.code })
        return
      case "remediation.verification_succeeded":
        record.audit.push({ ...base, kind: event.kind, artifactSha256: event.artifactSha256 })
    }
  }
}

type ParsedExecutorResult =
  | { ok: true; value: IncidentRemediationExecutorResult }
  | { ok: false; code: "invalid_executor_result" | "verification_failed"; message: string }

function parseExecutorResult(value: unknown): ParsedExecutorResult {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["patch", "regression", "validation", "pullRequestPreview"])
    || !isPatch(value.patch)
    || !isRegression(value.regression)
    || !isValidation(value.validation)
    || !isPullRequestPreview(value.pullRequestPreview)) {
    return { ok: false, code: "invalid_executor_result", message: "The remediation executor returned an invalid result" }
  }
  if (value.regression.prePatch !== "failed"
    || value.regression.postPatch !== "passed"
    || value.validation.status !== "passed") {
    return { ok: false, code: "verification_failed", message: "Remediation verification did not prove a failing-then-passing regression and full validation" }
  }
  return { ok: true, value: value as unknown as IncidentRemediationExecutorResult }
}

function isPatch(value: unknown): value is IncidentRemediationExecutorResult["patch"] {
  if (!isPlainObject(value) || !hasExactKeys(value, ["summary", "changedFiles", "unifiedDiff"])) return false
  if (!isBoundedText(value.summary, 500)
    || !Array.isArray(value.changedFiles)
    || value.changedFiles.length === 0
    || !value.changedFiles.every(isSafeRelativePath)
    || new Set(value.changedFiles).size !== value.changedFiles.length
    || !isNonEmpty(value.unifiedDiff)) return false
  if (typeof value.unifiedDiff !== "string"
    || value.unifiedDiff.length > 512 * 1024
    || value.unifiedDiff.includes("\0")
    || value.unifiedDiff.includes("\r")
    || !value.unifiedDiff.startsWith("diff --git ")) return false
  const diffFiles = [...value.unifiedDiff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)]
  if (diffFiles.length === 0 || diffFiles.some((match) => match[1] !== match[2] || !isSafeRelativePath(match[1]))) return false
  const declaredFiles = [...value.changedFiles].sort()
  const discoveredFiles = [...new Set(diffFiles.map((match) => match[1]!))].sort()
  return declaredFiles.length === discoveredFiles.length
    && declaredFiles.every((path, index) => path === discoveredFiles[index])
}

function isRegression(value: unknown): value is IncidentRemediationExecutorResult["regression"] {
  return isPlainObject(value)
    && hasExactKeys(value, ["test", "prePatch", "postPatch"])
    && isBoundedText(value.test, 500)
    && ["failed", "passed", "not_run"].includes(value.prePatch as string)
    && ["failed", "passed", "not_run"].includes(value.postPatch as string)
}

function isValidation(value: unknown): value is IncidentRemediationExecutorResult["validation"] {
  return isPlainObject(value)
    && hasExactKeys(value, ["status", "checks"])
    && (value.status === "passed" || value.status === "failed")
    && Array.isArray(value.checks)
    && value.checks.length > 0
    && value.checks.length <= 100
    && value.checks.every((check) => isBoundedText(check, 500))
}

function isPullRequestPreview(value: unknown): value is IncidentRemediationExecutorResult["pullRequestPreview"] {
  return isPlainObject(value)
    && hasExactKeys(value, ["title", "body", "baseBranch", "headBranch"])
    && isBoundedText(value.title, 300)
    && isBoundedText(value.body, 20_000)
    && isBranch(value.baseBranch)
    && isBranch(value.headBranch)
    && value.baseBranch !== value.headBranch
}

function toPublicArtifact(result: IncidentRemediationExecutorResult): IncidentRemediationArtifact {
  const patch = {
    summary: result.patch.summary.trim(),
    changedFiles: result.patch.changedFiles.map((path) => path.trim()),
    unifiedDiff: result.patch.unifiedDiff,
    sha256: createHash("sha256").update(result.patch.unifiedDiff).digest("hex"),
  }
  const regression = { test: result.regression.test.trim(), prePatch: "failed" as const, postPatch: "passed" as const }
  const validation = { status: "passed" as const, checks: result.validation.checks.map((check) => check.trim()) }
  const preview = {
    title: result.pullRequestPreview.title.trim(),
    body: result.pullRequestPreview.body.trim(),
    baseBranch: result.pullRequestPreview.baseBranch,
    headBranch: result.pullRequestPreview.headBranch,
  }
  const id = `pr_preview_${createHash("sha256").update(JSON.stringify({ patch, regression, validation, preview })).digest("hex").slice(0, 24)}`
  return { patch, regression, validation, pullRequestPreview: { id, ...preview } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return isNonEmpty(value) && value.length <= maxLength && !value.includes("\0")
}

function isSafeRelativePath(value: unknown): value is string {
  if (!isNonEmpty(value) || value.length > 512 || value.startsWith("/") || value.includes("\\")) return false
  return value.split("/").every((segment) => /^[A-Za-z0-9._@+-]+$/.test(segment) && segment !== "." && segment !== "..")
}

function isBranch(value: unknown): value is string {
  return isNonEmpty(value) && value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.includes("..")
}

function copy<T>(value: T): T {
  return structuredClone(value)
}
