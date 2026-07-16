import { describe, expect, test } from "bun:test"
import type { BuildIncident, IncidentDelivery, IncidentRemediation } from "@podo/contracts"

import { SettingsStore } from "../../settings"
import { IncidentAuditStore } from "../audit/incident-audit"
import {
  BuildIncidentActionService,
  type BuildIncidentActionsPort,
  type BuildIncidentSource,
} from "./build-incident-actions"

const sourceHead = "c".repeat(40)
const remediationHead = "d".repeat(40)
const resultTree = "e".repeat(40)

function incident(): BuildIncident {
  return {
    id: "build_incident_0123456789abcdef01234567",
    status: "awaiting_action",
    detector: "github_actions_failure",
    provider: "github_actions",
    repository: "reseaxch/podo",
    affectedService: "Workspace",
    workflow: { id: 3001, name: "Workspace", path: ".github/workflows/ci.yml" },
    sourceRun: {
      id: 91377001,
      workflowId: 3001,
      workflowName: "Workspace",
      workflowPath: ".github/workflows/ci.yml",
      runNumber: 77,
      attempt: 1,
      event: "push",
      headBranch: "main",
      headSha: sourceHead,
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-07-16T08:00:00.000Z",
      updatedAt: "2026-07-16T08:04:00.000Z",
      url: "https://github.com/reseaxch/podo/actions/runs/91377001",
    },
    evidence: [{
      id: "build_evidence_0123456789abcdef01234567",
      sourceId: "workflow_run:91377001:attempt:1",
      sourceType: "github_actions_workflow_run",
      observedAt: "2026-07-16T08:04:00.000Z",
      repository: "reseaxch/podo",
      runId: 91377001,
      runAttempt: 1,
      headSha: sourceHead,
      summary: "Workflow Workspace failed",
      workflowId: 3001,
      workflowName: "Workspace",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/reseaxch/podo/actions/runs/91377001",
    }],
    diagnosis: {
      status: "validated",
      schemaVersion: "podo.diagnosis.v1",
      summary: "Workspace test failed",
      affectedService: "Workspace",
      probableRootCause: "A deterministic regression",
      confidence: { value: 9500, scale: "basis_points" },
      evidenceIds: ["build_evidence_0123456789abcdef01234567"],
      recommendedAction: "Retry once or prepare a tested remediation",
      safeToAttemptFix: true,
    },
    createdAt: "2026-07-16T08:04:00.000Z",
    updatedAt: "2026-07-16T08:05:00.000Z",
  }
}

function source(value = incident()): BuildIncidentSource {
  let current = structuredClone(value)
  return {
    get(id) { return id === current.id ? structuredClone(current) : null },
    list() { return [structuredClone(current)] },
    setRetry(id, retry) {
      if (id !== current.id
        || retry.sourceRun.id !== current.sourceRun.id
        || retry.sourceRun.attempt !== current.sourceRun.attempt
        || retry.sourceRun.headSha !== current.sourceRun.headSha) return null
      current.retry = structuredClone(retry)
      current.status = retry.status === "pending_approval" ? "retry_pending_approval"
        : retry.status === "dispatching" ? "retrying"
          : retry.status === "awaiting_ci_result" ? "awaiting_ci_result"
            : retry.status === "verified" ? "verified"
              : retry.status === "denied" ? "denied" : "failed"
      current.updatedAt = retry.updatedAt
      if (retry.result) current.ciResult = structuredClone(retry.result)
      return structuredClone(current)
    },
    markRemediating(id) {
      if (id !== current.id) return null
      current.status = "remediating"
      return structuredClone(current)
    },
    markRemediationResolution(id, status) {
      if (id !== current.id) return null
      current.status = status
      return structuredClone(current)
    },
    setRemediationVerification(id, verification) {
      if (id !== current.id
        || verification.repository !== current.repository
        || verification.workflowId !== current.workflow.id) return null
      current.remediationVerification = structuredClone(verification)
      current.status = verification.status === "verified" ? "verified"
        : verification.status === "failed" ? "failed" : "awaiting_ci_result"
      current.updatedAt = verification.updatedAt
      if (verification.result) current.ciResult = structuredClone(verification.result)
      return structuredClone(current)
    },
    setVerifiedCiResult(id, result) {
      if (id !== current.id
        || result.repository !== current.repository
        || result.workflowId !== current.workflow.id) return null
      current.ciResult = structuredClone(result)
      current.status = "verified"
      current.updatedAt = result.verifiedAt
      return structuredClone(current)
    },
  }
}

function remediation(): IncidentRemediation {
  return {
    id: "remediation_01234567-89ab-cdef-0123-456789abcdef",
    incidentId: incident().id,
    status: "completed",
    target: "isolated_checkout",
    approval: { id: "approval_remediation", status: "approved" },
    createdAt: "2026-07-16T08:06:00.000Z",
    updatedAt: "2026-07-16T08:08:00.000Z",
    artifact: {
      provenance: { baseRef: "main", baseCommit: sourceHead, resultTreeOid: resultTree },
      evidenceIds: ["build_evidence_0123456789abcdef01234567"],
      patch: {
        summary: "Fix deterministic regression",
        changedFiles: ["packages/example/src/index.ts", "packages/example/src/index.test.ts"],
        unifiedDiff: "diff --git a/a b/a",
        sha256: "f".repeat(64),
      },
      regression: { test: "bun test packages/example", prePatch: "failed", postPatch: "passed" },
      validation: { status: "passed", checks: ["bun test packages/example"] },
      pullRequestPreview: {
        id: "artifact_0123456789abcdef",
        title: "Fix workspace regression",
        body: "Evidence-backed remediation",
        baseBranch: "main",
        headBranch: "podo/remediation-0123456789abcdef",
      },
    },
  }
}

function delivery(): IncidentDelivery {
  const fixed = remediation()
  return {
    id: "delivery_01234567-89ab-cdef-0123-456789abcdef",
    incidentId: fixed.incidentId,
    remediationId: fixed.id,
    artifactId: fixed.artifact!.pullRequestPreview.id,
    status: "delivered",
    approval: { id: "approval_delivery", status: "approved" },
    createdAt: "2026-07-16T08:08:00.000Z",
    updatedAt: "2026-07-16T08:09:00.000Z",
    pullRequest: {
      provider: "github",
      repository: "reseaxch/podo",
      number: 42,
      url: "https://github.com/reseaxch/podo/pull/42",
      baseCommit: sourceHead,
      baseBranch: "main",
      headBranch: fixed.artifact!.pullRequestPreview.headBranch,
      headSha: remediationHead,
      artifactId: fixed.artifact!.pullRequestPreview.id,
      proof: {
        providerStatus: "created",
        idempotencyKey: "delivery_01234567-89ab-cdef-0123-456789abcdef",
        resultTreeOid: fixed.artifact!.provenance.resultTreeOid,
        patchSha256: fixed.artifact!.patch.sha256,
        validationChecks: [...fixed.artifact!.validation.checks],
        evidenceIds: [...fixed.artifact!.evidenceIds],
        authorization: {
          approvalId: "approval_delivery",
          approvedBy: "fixture-operator",
          approvedAt: "2026-07-16T08:09:00.000Z",
        },
      },
    },
  }
}

function fixture(
  actions: BuildIncidentActionsPort,
  options: { now?: () => Date; verificationTimeoutMs?: number; operatorIdentity?: string } = {},
) {
  const settings = new SettingsStore()
  settings.update({ autonomyMode: "act_with_approval" })
  const audit = new IncidentAuditStore()
  const service = new BuildIncidentActionService({
    repository: { owner: "reseaxch", name: "podo" },
    operatorIdentity: options.operatorIdentity ?? "fixture-operator",
    verificationTimeoutMs: options.verificationTimeoutMs ?? 60_000,
    now: options.now ?? (() => new Date("2026-07-16T08:10:00.000Z")),
    actions,
  }, source(), settings, audit, {
    get() { return { ok: true, remediation: remediation() } },
  }, {
    get() { return { ok: true, delivery: delivery() } },
  })
  return { service, settings, audit }
}

describe("BuildIncidentActionService", () => {
  test("performs an approved retry once and verifies only the exact next attempt", async () => {
    const writes: unknown[] = []
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs(input) {
        writes.push(structuredClone(input))
        return {
          status: "accepted",
          repository: { owner: "reseaxch", name: "podo" },
          incidentId: incident().id,
          idempotencyKey: input.idempotencyKey,
          run: { id: 91377001, headSha: sourceHead, previousAttempt: 1 },
          authorization: {
            approvalId: input.authorization.approvalId,
            approvedBy: "fixture-operator",
            approvedAt: "2026-07-16T08:10:00.000Z",
          },
        }
      },
      async getCurrentRun() {
        return {
          ...incident().sourceRun,
          attempt: 2,
          status: "completed",
          conclusion: "success",
          updatedAt: "2026-07-16T08:12:00.000Z",
        }
      },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service, audit } = fixture(actions)

    const started = service.startRetry(incident().id)
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error("retry should start")
    expect(started.retry.status).toBe("pending_approval")
    expect(writes).toEqual([])

    const decided = await service.decideRetry(
      incident().id,
      started.retry.approval.id,
      "approve",
    )
    expect(decided.ok).toBe(true)
    if (!decided.ok) throw new Error("retry should be approved")
    expect(decided.retry).toMatchObject({
      status: "verified",
      approval: { status: "approved" },
      result: {
        mode: "retry",
        runId: 91377001,
        runAttempt: 2,
        headSha: sourceHead,
        conclusion: "success",
      },
    })
    expect(decided.incident).toMatchObject({ status: "verified", ciResult: { mode: "retry" } })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      authorization: { kind: "core.github_actions_retry.v1", decision: "approved" },
      incidentId: incident().id,
      repository: { owner: "reseaxch", name: "podo" },
      run: { id: 91377001, attempt: 1, headSha: sourceHead },
    })

    const repeated = await service.decideRetry(incident().id, started.retry.approval.id, "approve")
    expect(repeated.ok).toBe(true)
    expect(writes).toHaveLength(1)
    expect(audit.getBuild(incident().id).map(({ kind }) => kind)).toEqual([
      "build.retry_requested",
      "build.retry_approval_decided",
      "build.retry_dispatch_attempted",
      "build.retry_dispatched",
      "build.retry_ci_result_observed",
      "build.retry_verified",
    ])
  })

  test("records retry denial without invoking GitHub", async () => {
    let providerCalls = 0
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { providerCalls++; throw new Error("must not run") },
      async getCurrentRun() { providerCalls++; throw new Error("must not run") },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service, audit } = fixture(actions)
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")

    const denied = await service.decideRetry(
      incident().id,
      started.retry.approval.id,
      "deny",
    )
    expect(denied.ok).toBe(true)
    if (!denied.ok) throw new Error("retry denial should be represented")
    expect(denied.retry).toMatchObject({
      status: "denied",
      approval: { status: "denied" },
    })
    expect(denied.incident.status).toBe("denied")
    expect(providerCalls).toBe(0)
    expect(audit.getBuild(incident().id)).toMatchObject([
      { kind: "build.retry_requested", retryId: started.retry.id },
      {
        kind: "build.retry_approval_decided",
        retryId: started.retry.id,
        decision: "deny",
        decidedBy: "fixture-operator",
      },
    ])
  })

  test("keeps the configured audit actor within the production identity boundary", async () => {
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { throw new Error("must not run") },
      async getCurrentRun() { throw new Error("must not run") },
      async listRunsForHead() { throw new Error("not used") },
    }
    const maximumIdentity = "o".repeat(320)
    const { service, audit } = fixture(actions, { operatorIdentity: maximumIdentity })
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")
    await service.decideRetry(incident().id, started.retry.approval.id, "deny")
    expect(audit.getBuild(incident().id).at(-1)).toMatchObject({
      kind: "build.retry_approval_decided",
      decidedBy: maximumIdentity,
    })

    expect(() => fixture(actions, { operatorIdentity: "o".repeat(321) }))
      .toThrow("invalid_build_incident_action_config")
    expect(() => fixture(actions, { operatorIdentity: "operator\nattacker" }))
      .toThrow("invalid_build_incident_action_config")
  })

  test("audits a provider dispatch attempt before a sanitized terminal failure and never retries it", async () => {
    let writes = 0
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { writes++; throw new Error("lost provider response with secret") },
      async getCurrentRun() { throw new Error("must not run") },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service, audit } = fixture(actions)
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")

    const failed = await service.decideRetry(
      incident().id,
      started.retry.approval.id,
      "approve",
    )
    expect(failed.ok).toBe(true)
    if (!failed.ok) throw new Error("retry failure should be represented")
    expect(failed.retry).toMatchObject({
      status: "failed",
      approval: { status: "approved" },
      error: { code: "retry_failed", message: "GitHub Actions retry failed" },
    })
    expect(JSON.stringify(failed)).not.toContain("lost provider response")

    const repeated = await service.decideRetry(
      incident().id,
      started.retry.approval.id,
      "approve",
    )
    expect(repeated).toEqual(failed)
    expect(writes).toBe(1)
    expect(audit.getBuild(incident().id)).toMatchObject([
      { kind: "build.retry_requested", retryId: started.retry.id },
      { kind: "build.retry_approval_decided", decision: "approve", decidedBy: "fixture-operator" },
      {
        kind: "build.retry_dispatch_attempted",
        retryId: started.retry.id,
        approvalId: started.retry.approval.id,
        approvedBy: "fixture-operator",
        repository: "reseaxch/podo",
        idempotencyKey: started.retry.id,
        runId: 91377001,
        headSha: sourceHead,
        previousAttempt: 1,
      },
      { kind: "build.retry_failed", retryId: started.retry.id, code: "retry_failed" },
    ])
  })

  test("records the exact next retry attempt as a terminal CI failure", async () => {
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs(input) {
        return {
          status: "accepted",
          repository: input.repository,
          incidentId: input.incidentId,
          idempotencyKey: input.idempotencyKey,
          run: { id: input.run.id, headSha: input.run.headSha, previousAttempt: input.run.attempt },
          authorization: {
            approvalId: input.authorization.approvalId,
            approvedBy: input.authorization.approvedBy,
            approvedAt: input.authorization.approvedAt,
          },
        }
      },
      async getCurrentRun() {
        return {
          ...incident().sourceRun,
          attempt: 2,
          status: "completed",
          conclusion: "failure",
          updatedAt: "2026-07-16T08:12:00.000Z",
        }
      },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service, audit } = fixture(actions)
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")
    const failed = await service.decideRetry(incident().id, started.retry.approval.id, "approve")
    expect(failed.ok).toBe(true)
    if (!failed.ok) throw new Error("CI failure should be represented")
    expect(failed.retry).toMatchObject({ status: "failed", error: { code: "ci_failed" } })
    expect(failed.incident).toMatchObject({ status: "failed" })
    expect(failed.incident.ciResult).toBeUndefined()
    expect(audit.getBuild(incident().id).slice(-2)).toMatchObject([
      {
        kind: "build.retry_ci_result_observed",
        runId: 91377001,
        runAttempt: 2,
        headSha: sourceHead,
        status: "completed",
        conclusion: "failure",
      },
      { kind: "build.retry_failed", code: "ci_failed" },
    ])
  })

  test("waits for GitHub retry propagation and starts the timeout only after dispatch", async () => {
    let now = new Date("2026-07-16T08:10:00.000Z")
    let reads = 0
    let writes = 0
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs(input) {
        writes++
        return {
          status: "accepted",
          repository: input.repository,
          incidentId: input.incidentId,
          idempotencyKey: input.idempotencyKey,
          run: {
            id: input.run.id,
            headSha: input.run.headSha,
            previousAttempt: input.run.attempt,
          },
          authorization: {
            approvalId: input.authorization.approvalId,
            approvedBy: input.authorization.approvedBy,
            approvedAt: input.authorization.approvedAt,
          },
        }
      },
      async getCurrentRun() {
        reads++
        return reads === 1
          ? structuredClone(incident().sourceRun)
          : {
              ...incident().sourceRun,
              attempt: 2,
              status: "completed",
              conclusion: "success",
              updatedAt: "2026-07-16T08:12:30.000Z",
            }
      },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service, audit } = fixture(actions, {
      now: () => new Date(now),
      verificationTimeoutMs: 60_000,
    })
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")

    // Human approval arrives after the configured verification timeout. That
    // delay must not consume the post-dispatch CI observation window.
    now = new Date("2026-07-16T08:12:00.000Z")
    const approved = await service.decideRetry(
      incident().id,
      started.retry.approval.id,
      "approve",
    )
    expect(approved.ok).toBe(true)
    if (!approved.ok) throw new Error("retry should be approved")
    expect(approved.retry.status).toBe("awaiting_ci_result")
    expect(writes).toBe(1)
    expect(reads).toBe(1)

    now = new Date("2026-07-16T08:12:30.000Z")
    const verified = await service.getRetry(incident().id)
    expect(verified.ok).toBe(true)
    if (!verified.ok) throw new Error("retry should be observable")
    expect(verified.retry).toMatchObject({
      status: "verified",
      result: { mode: "retry", runAttempt: 2, headSha: sourceHead },
    })
    expect(writes).toBe(1)
    expect(reads).toBe(2)
    expect(audit.getBuild(incident().id).map(({ kind }) => kind)).toEqual([
      "build.retry_requested",
      "build.retry_approval_decided",
      "build.retry_dispatch_attempted",
      "build.retry_dispatched",
      "build.retry_ci_result_observed",
      "build.retry_verified",
    ])
  })

  test("shares one in-flight retry observation across concurrent readers", async () => {
    let reads = 0
    let release!: (value: unknown) => void
    const observation = new Promise<unknown>((resolve) => { release = resolve })
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs(input) {
        return {
          status: "accepted",
          repository: input.repository,
          incidentId: input.incidentId,
          idempotencyKey: input.idempotencyKey,
          run: { id: input.run.id, headSha: input.run.headSha, previousAttempt: input.run.attempt },
          authorization: {
            approvalId: input.authorization.approvalId,
            approvedBy: input.authorization.approvedBy,
            approvedAt: input.authorization.approvedAt,
          },
        }
      },
      async getCurrentRun() {
        reads++
        return reads === 1 ? structuredClone(incident().sourceRun) : observation
      },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service } = fixture(actions)
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")
    const approved = await service.decideRetry(incident().id, started.retry.approval.id, "approve")
    if (!approved.ok) throw new Error("retry should be approved")
    expect(approved.retry.status).toBe("awaiting_ci_result")

    const first = service.getRetry(incident().id)
    const second = service.getRetry(incident().id)
    await Promise.resolve()
    await Promise.resolve()
    expect(reads).toBe(2)
    release({
      ...incident().sourceRun,
      attempt: 2,
      status: "completed",
      conclusion: "success",
      updatedAt: "2026-07-16T08:12:00.000Z",
    })
    const [left, right] = await Promise.all([first, second])
    expect(left.ok && left.retry.status).toBe("verified")
    expect(right.ok && right.retry.status).toBe("verified")
    expect(reads).toBe(2)
  })

  test("fails closed when retry observation skips the exact next attempt", async () => {
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs(input) {
        const value = input as Record<string, any>
        return {
          status: "accepted",
          repository: value.repository,
          incidentId: value.incidentId,
          idempotencyKey: value.idempotencyKey,
          run: { id: value.run.id, headSha: value.run.headSha, previousAttempt: value.run.attempt },
          authorization: {
            approvalId: value.authorization.approvalId,
            approvedBy: value.authorization.approvedBy,
            approvedAt: value.authorization.approvedAt,
          },
        }
      },
      async getCurrentRun() {
        return { ...incident().sourceRun, attempt: 3, status: "completed", conclusion: "success" }
      },
      async listRunsForHead() { throw new Error("not used") },
    }
    const { service } = fixture(actions)
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")
    const decided = await service.decideRetry(incident().id, started.retry.approval.id, "approve")
    expect(decided.ok).toBe(true)
    if (!decided.ok) throw new Error("retry decision should be represented")
    expect(decided.retry).toMatchObject({
      status: "failed",
      error: { code: "ci_result_mismatch" },
    })
    expect(decided.incident.status).toBe("failed")
  })

  test("re-evaluates retry policy at approval time without invoking the write port", async () => {
    let writes = 0
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { writes++; throw new Error("must not run") },
      async getCurrentRun() { throw new Error("must not run") },
      async listRunsForHead() { throw new Error("must not run") },
    }
    const { service, settings, audit } = fixture(actions)
    const started = service.startRetry(incident().id)
    if (!started.ok) throw new Error("retry should start")
    settings.update({ autonomyMode: "recommend" })

    const decided = await service.decideRetry(incident().id, started.retry.approval.id, "approve")
    expect(decided.ok).toBe(true)
    if (!decided.ok) throw new Error("decision should be represented")
    expect(decided.retry).toMatchObject({
      status: "failed",
      approval: { status: "approved" },
      error: { code: "policy_denied" },
    })
    expect(writes).toBe(0)
    expect(audit.getBuild(incident().id).map(({ kind }) => kind)).toEqual([
      "build.retry_requested",
      "build.retry_approval_decided",
      "build.retry_failed",
    ])
  })

  test("verifies remediation CI only for the exact tested and delivered head", async () => {
    const reads: unknown[] = []
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { throw new Error("not used") },
      async getCurrentRun() { throw new Error("not used") },
      async listRunsForHead(input) {
        reads.push(structuredClone(input))
        return {
          repository: { owner: "reseaxch", name: "podo" },
          headSha: remediationHead,
          runs: [{
            ...incident().sourceRun,
            id: 91377002,
            runNumber: 78,
            headBranch: "podo/remediation-0123456789abcdef",
            headSha: remediationHead,
            status: "completed",
            conclusion: "success",
            createdAt: "2026-07-16T08:09:30.000Z",
            updatedAt: "2026-07-16T08:11:00.000Z",
            url: "https://github.com/reseaxch/podo/actions/runs/91377002",
          }],
        }
      },
    }
    const { service, audit } = fixture(actions)

    service.syncRemediation(incident().id)
    const result = await service.startRemediationVerification(incident().id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("verification should start")
    expect(result.verification).toMatchObject({
      status: "verified",
      remediationId: remediation().id,
      artifactId: remediation().artifact!.pullRequestPreview.id,
      resultTreeOid: resultTree,
      headSha: remediationHead,
      result: {
        mode: "remediation",
        artifactId: remediation().artifact!.pullRequestPreview.id,
        runId: 91377002,
        headSha: remediationHead,
        conclusion: "success",
      },
    })
    expect(result.incident).toMatchObject({ status: "verified", ciResult: { mode: "remediation" } })
    expect(reads).toEqual([{
      repository: { owner: "reseaxch", name: "podo" },
      headSha: remediationHead,
    }])
    expect(audit.getBuild(incident().id).map(({ kind }) => kind)).toEqual([
      "build.remediation_requested",
      "build.remediation_approval_decided",
      "build.remediation_tested",
      "build.delivery_requested",
      "build.delivery_approval_decided",
      "build.remediation_delivered",
      "build.remediation_ci_verification_started",
      "build.remediation_ci_result_observed",
      "build.remediation_verified",
    ])
  })

  test("shares one in-flight remediation CI observation across concurrent starters", async () => {
    let reads = 0
    let release!: (value: unknown) => void
    const observation = new Promise<unknown>((resolve) => { release = resolve })
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { throw new Error("not used") },
      async getCurrentRun() { throw new Error("not used") },
      async listRunsForHead() {
        reads++
        return observation
      },
    }
    const { service } = fixture(actions)

    const first = service.startRemediationVerification(incident().id)
    const second = service.startRemediationVerification(incident().id)
    await Promise.resolve()
    expect(reads).toBe(1)
    release({
      repository: { owner: "reseaxch", name: "podo" },
      headSha: remediationHead,
      runs: [{
        ...incident().sourceRun,
        id: 91377002,
        runNumber: 78,
        headBranch: "podo/remediation-0123456789abcdef",
        headSha: remediationHead,
        status: "completed",
        conclusion: "success",
        createdAt: "2026-07-16T08:09:30.000Z",
        updatedAt: "2026-07-16T08:11:00.000Z",
        url: "https://github.com/reseaxch/podo/actions/runs/91377002",
      }],
    })
    const [left, right] = await Promise.all([first, second])
    expect(left.ok && left.verification.status).toBe("verified")
    expect(right.ok && right.verification.status).toBe("verified")
    expect(reads).toBe(1)
  })

  test("records a matching remediation run that completes unsuccessfully as terminal CI failure", async () => {
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { throw new Error("not used") },
      async getCurrentRun() { throw new Error("not used") },
      async listRunsForHead() {
        return {
          repository: { owner: "reseaxch", name: "podo" },
          headSha: remediationHead,
          runs: [{
            ...incident().sourceRun,
            id: 91377002,
            runNumber: 78,
            headBranch: "podo/remediation-0123456789abcdef",
            headSha: remediationHead,
            status: "completed",
            conclusion: "failure",
            createdAt: "2026-07-16T08:09:30.000Z",
            updatedAt: "2026-07-16T08:11:00.000Z",
            url: "https://github.com/reseaxch/podo/actions/runs/91377002",
          }],
        }
      },
    }
    const { service, audit } = fixture(actions)
    const result = await service.startRemediationVerification(incident().id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("remediation CI failure should be represented")
    expect(result.verification).toMatchObject({
      status: "failed",
      headSha: remediationHead,
      error: { code: "ci_failed" },
    })
    expect(result.incident).toMatchObject({ status: "failed" })
    expect(result.incident.ciResult).toBeUndefined()
    expect(audit.getBuild(incident().id).slice(-2)).toMatchObject([
      {
        kind: "build.remediation_ci_result_observed",
        runId: 91377002,
        runAttempt: 1,
        headSha: remediationHead,
        status: "completed",
        conclusion: "failure",
      },
      { kind: "build.remediation_ci_failed", code: "ci_failed" },
    ])
  })

  test("never counts a successful source run as remediation verification", async () => {
    const actions: BuildIncidentActionsPort = {
      async retryFailedJobs() { throw new Error("not used") },
      async getCurrentRun() { throw new Error("not used") },
      async listRunsForHead() {
        return {
          repository: { owner: "reseaxch", name: "podo" },
          headSha: sourceHead,
          runs: [{ ...incident().sourceRun, status: "completed", conclusion: "success" }],
        }
      },
    }
    const { service } = fixture(actions)

    const result = await service.startRemediationVerification(incident().id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("verification state should be represented")
    expect(result.verification).toMatchObject({
      status: "failed",
      headSha: remediationHead,
      error: { code: "ci_result_mismatch" },
    })
    expect(result.incident).toMatchObject({ status: "failed" })
    expect(result.incident.ciResult).toBeUndefined()
  })
})
