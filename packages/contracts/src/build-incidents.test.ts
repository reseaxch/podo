import { describe, expect, test } from "bun:test"
import type {
  BuildIncident,
  BuildIncidentAuditEvent,
  BuildIncidentRetry,
  BuildRemediationVerification,
  DetectedIncident,
  GitHubActionsJobEvidence,
  GitHubActionsWorkflowRunSignal,
  GitHubActionsWorkflowRunEvidence,
} from "./index"

const repository = "reseaxch/podo"
const sourceHeadSha = "c".repeat(40)
const remediatedHeadSha = "d".repeat(40)

const workflowEvidence = {
  id: "build_evidence_workflow_1",
  sourceId: "91377001",
  sourceType: "github_actions_workflow_run",
  observedAt: "2026-07-16T08:04:00.000Z",
  repository,
  runId: 91_377_001,
  runAttempt: 1,
  headSha: sourceHeadSha,
  summary: "Workspace workflow completed with failure",
  workflowId: 3_001,
  workflowName: "Workspace",
  status: "completed",
  conclusion: "failure",
  url: "https://github.com/reseaxch/podo/actions/runs/91377001",
} satisfies GitHubActionsWorkflowRunEvidence

const jobEvidence = {
  id: "build_evidence_job_1",
  sourceId: "81001",
  sourceType: "github_actions_job",
  observedAt: "2026-07-16T08:03:40.000Z",
  repository,
  runId: 91_377_001,
  runAttempt: 1,
  headSha: sourceHeadSha,
  summary: "Run workspace tests failed",
  jobId: 81_001,
  jobName: "Workspace",
  status: "completed",
  conclusion: "failure",
  url: "https://github.com/reseaxch/podo/actions/runs/91377001/job/81001",
} satisfies GitHubActionsJobEvidence

const retry = {
  id: "build_retry_1",
  status: "verified",
  approval: { id: "approval_retry_1", status: "approved" },
  sourceRun: { id: 91_377_001, attempt: 1, headSha: sourceHeadSha },
  createdAt: "2026-07-16T08:05:00.000Z",
  updatedAt: "2026-07-16T08:10:00.000Z",
  result: {
    provider: "github_actions",
    mode: "retry",
    repository,
    workflowId: 3_001,
    runId: 91_377_001,
    runAttempt: 2,
    headSha: sourceHeadSha,
    status: "completed",
    conclusion: "success",
    url: "https://github.com/reseaxch/podo/actions/runs/91377001",
    verifiedAt: "2026-07-16T08:10:00.000Z",
  },
} satisfies BuildIncidentRetry

const remediationVerification = {
  id: "build_verification_1",
  status: "verified",
  repository,
  workflowId: 3_001,
  remediationId: "remediation_1",
  artifactId: "artifact_1",
  resultTreeOid: "e".repeat(40),
  headBranch: "podo/remediation-0123456789abcdef",
  headSha: remediatedHeadSha,
  createdAt: "2026-07-16T08:12:00.000Z",
  updatedAt: "2026-07-16T08:17:00.000Z",
  result: {
    provider: "github_actions",
    mode: "remediation",
    repository,
    workflowId: 3_001,
    runId: 91_377_002,
    runAttempt: 1,
    headSha: remediatedHeadSha,
    status: "completed",
    conclusion: "success",
    url: "https://github.com/reseaxch/podo/actions/runs/91377002",
    verifiedAt: "2026-07-16T08:17:00.000Z",
    artifactId: "artifact_1",
  },
} satisfies BuildRemediationVerification

const buildIncident = {
  id: "build_incident_1",
  status: "verified",
  detector: "github_actions_failure",
  provider: "github_actions",
  repository,
  affectedService: "Workspace",
  workflow: { id: 3_001, name: "Workspace", path: ".github/workflows/ci.yml" },
  sourceRun: {
    id: 91_377_001,
    workflowId: 3_001,
    workflowName: "Workspace",
    workflowPath: ".github/workflows/ci.yml",
    runNumber: 77,
    attempt: 1,
    event: "push",
    headBranch: "main",
    headSha: sourceHeadSha,
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-07-16T08:00:00.000Z",
    updatedAt: "2026-07-16T08:04:00.000Z",
    url: "https://github.com/reseaxch/podo/actions/runs/91377001",
  },
  evidence: [workflowEvidence, jobEvidence],
  createdAt: "2026-07-16T08:04:00.000Z",
  updatedAt: "2026-07-16T08:17:00.000Z",
  retry,
  ciResult: retry.result,
} satisfies BuildIncident

const { retry: _verifiedRetry, ciResult: _retryResult, ...buildIncidentWithoutRetry } = buildIncident
const remediatedBuildIncident = {
  ...buildIncidentWithoutRetry,
  remediationVerification,
  ciResult: remediationVerification.result,
} satisfies BuildIncident

describe("build incident contracts", () => {
  test("keeps Build Incidents separate while preserving the runtime incident contract", () => {
    const runtimeIncident = {
      id: "incident_runtime_1",
      status: "detected",
      detector: "cache_growth",
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
      createdAt: "2026-07-16T08:00:00.000Z",
      updatedAt: "2026-07-16T08:00:00.000Z",
      evidence: [],
    } satisfies DetectedIncident

    expect(runtimeIncident.detector).toBe("cache_growth")
    expect(buildIncident.detector).toBe("github_actions_failure")
    expect(buildIncident.evidence.map(({ sourceType }) => sourceType)).toEqual([
      "github_actions_workflow_run",
      "github_actions_job",
    ])
  })

  test("binds ingress, retry, and remediation verification to exact run and head identities", () => {
    const ingress = {
      provider: "github",
      event: "workflow_run",
      action: "completed",
      deliveryId: "delivery-build-1",
      repository: { owner: "reseaxch", name: "podo" },
      run: { id: 91_377_001, attempt: 1, headSha: sourceHeadSha },
    } satisfies GitHubActionsWorkflowRunSignal

    expect(ingress.run).toEqual(retry.sourceRun)
    expect(retry.result.runAttempt).toBeGreaterThan(retry.sourceRun.attempt)
    expect(remediatedBuildIncident.remediationVerification.result.headSha).toBe(
      remediatedBuildIncident.remediationVerification.headSha,
    )
    expect(remediatedBuildIncident.remediationVerification.result.artifactId).toBe(
      remediatedBuildIncident.remediationVerification.artifactId,
    )
  })

  test("carries monotonic audit sequence and CI-attempt fields", () => {
    const events = [
      {
        sequence: 1,
        occurredAt: "2026-07-16T08:05:00.000Z",
        incidentId: buildIncident.id,
        kind: "build.retry_dispatch_attempted",
        retryId: retry.id,
        approvalId: retry.approval.id,
        approvedBy: "uc13-fixture-operator",
        approvedAt: "2026-07-16T08:05:00.000Z",
        repository,
        idempotencyKey: retry.id,
        runId: retry.sourceRun.id,
        headSha: retry.sourceRun.headSha,
        previousAttempt: 1,
      },
      {
        sequence: 2,
        occurredAt: "2026-07-16T08:05:01.000Z",
        incidentId: buildIncident.id,
        kind: "build.retry_dispatched",
        retryId: retry.id,
        approvalId: retry.approval.id,
        approvedBy: "uc13-fixture-operator",
        approvedAt: "2026-07-16T08:05:00.000Z",
        providerStatus: "accepted",
        repository,
        idempotencyKey: retry.id,
        runId: retry.sourceRun.id,
        headSha: retry.sourceRun.headSha,
        previousAttempt: 1,
        expectedRunAttempt: 2,
      },
      {
        sequence: 3,
        occurredAt: "2026-07-16T08:10:00.000Z",
        incidentId: buildIncident.id,
        kind: "build.retry_verified",
        retryId: retry.id,
        runId: retry.result.runId,
        runAttempt: retry.result.runAttempt,
      },
      {
        sequence: 4,
        occurredAt: "2026-07-16T08:17:00.000Z",
        incidentId: buildIncident.id,
        kind: "build.remediation_verified",
        verificationId: remediationVerification.id,
        remediationId: remediationVerification.remediationId,
        artifactId: remediationVerification.artifactId,
        runId: remediationVerification.result.runId,
        runAttempt: remediationVerification.result.runAttempt,
        headSha: remediationVerification.headSha,
      },
    ] satisfies BuildIncidentAuditEvent[]

    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4])
    expect(events[2]!.runAttempt).toBe(events[1]!.expectedRunAttempt)
  })
})
