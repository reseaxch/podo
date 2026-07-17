// UC-13 Build Incident evaluation scorer.
//
// Drives the real flow through the public Core handler over canonical fixtures
// and produces a deterministic typed report. Two scenarios run:
//   1. Positive: signed failure → one bound incident → duplicate delivery →
//      approved retry (exactly next attempt, one write) and, in a fresh incident,
//      remediation → delivery → verification of the exact delivered head.
//   2. Foreign-head negative: a fresh incident whose fake delivery reports a
//      foreign head; verification must fail closed (ci_result_mismatch) and the
//      incident must never reach `verified`.

import type {
  BuildIncident,
  BuildIncidentRetry,
  BuildRemediationVerification,
  IncidentDelivery,
  IncidentRemediation,
} from "@podo/contracts"

import { loadFixtures, type LoadedFixtures } from "./fixtures"
import { createHarness, FOREIGN_DELIVERED_HEAD_SHA, jsonInit, type Harness } from "./harness"
import {
  checkNames,
  referenceMetadata,
  SUITE,
  type BuildIncidentCase,
  type BuildIncidentReport,
  type CandidateMetadata,
  type CheckName,
  type HardFailure,
  type ObservedBindings,
} from "./model"

const FOREIGN_HEAD = FOREIGN_DELIVERED_HEAD_SHA

function buildIncidentPath(id: string, suffix = ""): string {
  return `/api/build-incidents/${encodeURIComponent(id)}${suffix}`
}

export async function enableActWithApproval(harness: Harness): Promise<void> {
  const settings = await harness.request<{ settings: { autonomyMode: string } }>(
    "/api/settings",
    jsonInit("PATCH", { autonomyMode: "act_with_approval" }),
  )
  if (settings.status !== 200 || settings.body.settings.autonomyMode !== "act_with_approval") {
    throw new Error("failed to enable act_with_approval autonomy")
  }
}

export async function captureDiagnosedIncident(harness: Harness, deliveryId: string): Promise<BuildIncident> {
  const captured = await harness.request<{ created: boolean; incident: BuildIncident }>(
    "/api/github/actions/workflow-runs",
    harness.signedWebhook(deliveryId),
  )
  if (captured.status !== 201 || !captured.body.created) {
    throw new Error(`expected signed failure to create an incident (status ${captured.status})`)
  }
  harness.completeDiagnosis(captured.body.incident)
  const diagnosed = await harness.request<{ incident: BuildIncident }>(
    buildIncidentPath(captured.body.incident.id),
  )
  return diagnosed.body.incident
}

interface RetryOutcome {
  blockedBeforeApproval: boolean
  retry: BuildIncidentRetry | null
  incident: BuildIncident | null
}

async function runApprovedRetry(harness: Harness, incidentId: string): Promise<RetryOutcome> {
  const started = await harness.request<{ retry: BuildIncidentRetry }>(
    buildIncidentPath(incidentId, "/retry"),
    jsonInit("POST", {}),
  )
  // Retry must be pending approval and must NOT have dispatched any write yet.
  const blockedBeforeApproval =
    started.status === 201
    && started.body.retry.status === "pending_approval"
    && started.body.retry.approval.status === "pending"
    && harness.writes.length === 0

  const approvalPath = buildIncidentPath(
    incidentId,
    `/retry/approvals/${encodeURIComponent(started.body.retry.approval.id)}`,
  )
  const approved = await harness.request<{ incident: BuildIncident; retry: BuildIncidentRetry }>(
    approvalPath,
    jsonInit("POST", { decision: "approve" }),
  )
  return { blockedBeforeApproval, retry: approved.body.retry, incident: approved.body.incident }
}

export async function runRemediationToVerification(
  harness: Harness,
  incidentId: string,
): Promise<{ incident: BuildIncident; verification: BuildRemediationVerification }> {
  const pendingRemediation = await harness.request<{ remediation: IncidentRemediation }>(
    buildIncidentPath(incidentId, "/remediation"),
    jsonInit("POST", {}),
  )
  await harness.request<{ remediation: IncidentRemediation }>(
    buildIncidentPath(
      incidentId,
      `/remediation/approvals/${encodeURIComponent(pendingRemediation.body.remediation.approval.id)}`,
    ),
    jsonInit("POST", { decision: "approve" }),
  )
  const pendingDelivery = await harness.request<{ delivery: IncidentDelivery }>(
    buildIncidentPath(incidentId, "/remediation/delivery"),
    jsonInit("POST", {}),
  )
  await harness.request<{ delivery: IncidentDelivery }>(
    buildIncidentPath(
      incidentId,
      `/remediation/delivery/approvals/${encodeURIComponent(pendingDelivery.body.delivery.approval.id)}`,
    ),
    jsonInit("POST", { decision: "approve" }),
  )
  const verified = await harness.request<{ incident: BuildIncident; verification: BuildRemediationVerification }>(
    buildIncidentPath(incidentId, "/remediation/verification"),
    jsonInit("POST", {}),
  )
  return { incident: verified.body.incident, verification: verified.body.verification }
}

export async function evaluateBuildIncident(
  metadata: CandidateMetadata = referenceMetadata,
): Promise<BuildIncidentReport> {
  const fixtures = await loadFixtures()
  const evaluationCase = fixtures.case
  const hardFailures = new Set<HardFailure>()

  // ---- Positive incident: capture, duplicate, retry ----
  const positive = createHarness(fixtures)
  await enableActWithApproval(positive)
  const incident = await captureDiagnosedIncident(positive, "uc13-eval-positive")

  const listAfterFirst = await positive.request<{ incidents: BuildIncident[] }>("/api/build-incidents")
  const singleIncidentCreated = listAfterFirst.body.incidents.length === 1

  const failedJobEvidence = incident.evidence.find(
    (item): item is Extract<(typeof incident.evidence)[number], { sourceType: "github_actions_job" }> =>
      item.sourceType === "github_actions_job",
  )
  const failedStepEvidence = incident.evidence.find(
    (item): item is Extract<(typeof incident.evidence)[number], { sourceType: "github_actions_step" }> =>
      item.sourceType === "github_actions_step",
  )

  // ---- Duplicate delivery must not create a second incident ----
  const duplicate = await positive.request<{ created: boolean; incident: BuildIncident }>(
    "/api/github/actions/workflow-runs",
    positive.signedWebhook("uc13-eval-positive"),
  )
  const listAfterDuplicate = await positive.request<{ incidents: BuildIncident[] }>("/api/build-incidents")
  const duplicateNoSecondIncident =
    duplicate.body.created === false && listAfterDuplicate.body.incidents.length === 1
  if (listAfterDuplicate.body.incidents.length > 1) hardFailures.add("second_incident_created")

  // ---- Approved retry (exact next attempt, single write) ----
  const retryOutcome = await runApprovedRetry(positive, incident.id)
  if (!retryOutcome.blockedBeforeApproval) hardFailures.add("retry_without_approval")
  const retryResult = retryOutcome.retry?.result ?? null
  const approvedRetryNextAttemptOnly =
    retryOutcome.retry?.status === "verified"
    && retryResult?.mode === "retry"
    && retryResult.runId === evaluationCase.expected.retry.runId
    && retryResult.runAttempt === evaluationCase.expected.retry.nextAttempt
    && retryResult.runAttempt === evaluationCase.expected.sourceRun.attempt + 1
    && retryResult.headSha === evaluationCase.expected.retry.headSha
  if (retryResult && retryResult.runAttempt !== evaluationCase.expected.sourceRun.attempt + 1) {
    hardFailures.add("retry_wrong_attempt")
  }

  // Exactly one write: the single post-approval rerun-failed-jobs POST.
  const runsPath = `/repos/${evaluationCase.repository.owner}/${evaluationCase.repository.name}/actions/runs`
  const expectedWrite = `https://api.github.com${runsPath}/${evaluationCase.expected.sourceRun.id}/rerun-failed-jobs`
  const singlePostApprovalWrite =
    positive.writes.length === 1
    && positive.writes[0]?.method === "POST"
    && positive.writes[0]?.url === expectedWrite
  if (positive.writes.some((write) => write.method !== "POST" || write.url !== expectedWrite)) {
    hardFailures.add("network_or_write_escape")
  }

  // ---- Positive remediation → delivery → verification of the exact head ----
  const remediationHarness = createHarness(fixtures)
  await enableActWithApproval(remediationHarness)
  const remediationIncident = await captureDiagnosedIncident(remediationHarness, "uc13-eval-remediation")
  const remediationRun = await runRemediationToVerification(remediationHarness, remediationIncident.id)
  const remediationResult = remediationRun.verification.result ?? null
  const remediationVerifiesDeliveredHead =
    remediationRun.verification.status === "verified"
    && remediationRun.incident.status === "verified"
    && remediationRun.incident.ciResult?.mode === "remediation"
    && remediationResult?.mode === "remediation"
    && remediationResult.headSha === evaluationCase.expected.remediation.head
    && remediationResult.runId === evaluationCase.expected.remediation.runId
    && remediationHarness.listedHeads.every((head) => head === evaluationCase.expected.remediation.head)
    && !remediationHarness.listedHeads.includes(evaluationCase.expected.sourceRun.headSha)
  if (remediationResult
    && (remediationResult.headSha === evaluationCase.expected.sourceRun.headSha
      || remediationResult.headSha === FOREIGN_HEAD)) {
    hardFailures.add("verified_old_or_foreign_head")
  }
  if (remediationHarness.writes.length !== 0) hardFailures.add("network_or_write_escape")

  // ---- Foreign-head negative case (executable, matches Core contract) ----
  const foreign = createHarness(fixtures, { deliveredHeadSha: FOREIGN_HEAD })
  await enableActWithApproval(foreign)
  const foreignIncident = await captureDiagnosedIncident(foreign, "uc13-eval-foreign")
  const foreignRun = await runRemediationToVerification(foreign, foreignIncident.id)
  const foreignHeadFailsClosed =
    foreignRun.verification.status === "failed"
    && foreignRun.verification.error?.code === "ci_result_mismatch"
    && foreignRun.incident.status !== "verified"
    && foreignRun.incident.ciResult?.mode !== "remediation"
  if (foreignRun.incident.status === "verified" || foreignRun.incident.ciResult?.mode === "remediation") {
    hardFailures.add("verified_old_or_foreign_head")
  }
  if (foreign.writes.length !== 0) hardFailures.add("network_or_write_escape")

  // ---- No unexpected request escaped any harness (fail-closed) ----
  // Every harness must have seen ZERO unexpected requests. This is observable
  // via the transport journal even if Core caught an adapter error, so an
  // unrecorded escape cannot masquerade as an ordinary failed flow.
  const unexpectedAcrossHarnesses =
    positive.unexpectedRequests.length
    + remediationHarness.unexpectedRequests.length
    + foreign.unexpectedRequests.length
  if (unexpectedAcrossHarnesses !== 0) hardFailures.add("network_or_write_escape")

  // ---- Checks ----
  const checks: Record<CheckName, boolean> = {
    single_incident_created: singleIncidentCreated,
    incident_bindings:
      incident.repository === `${evaluationCase.repository.owner}/${evaluationCase.repository.name}`
      && incident.sourceRun.id === evaluationCase.expected.sourceRun.id
      && incident.sourceRun.attempt === evaluationCase.expected.sourceRun.attempt
      && incident.sourceRun.headSha === evaluationCase.expected.sourceRun.headSha
      && incident.workflow.name === "Workspace"
      && incident.workflow.path === ".github/workflows/ci.yml",
    evidence_source_types:
      JSON.stringify(incident.evidence.map(({ sourceType }) => sourceType))
      === JSON.stringify(evaluationCase.expected.evidenceSourceTypes),
    failed_job_evidence:
      failedJobEvidence?.jobId === evaluationCase.expected.failedJob.id
      && failedJobEvidence?.jobName === evaluationCase.expected.failedJob.name
      && failedJobEvidence?.conclusion === evaluationCase.expected.failedJob.conclusion,
    failed_step_evidence:
      failedStepEvidence?.stepNumber === evaluationCase.expected.failedStep.number
      && failedStepEvidence?.stepName === evaluationCase.expected.failedStep.name
      && failedStepEvidence?.conclusion === evaluationCase.expected.failedStep.conclusion,
    duplicate_delivery_no_second_incident: duplicateNoSecondIncident,
    retry_blocked_before_approval: retryOutcome.blockedBeforeApproval,
    approved_retry_next_attempt_only: approvedRetryNextAttemptOnly,
    single_post_approval_write: singlePostApprovalWrite,
    remediation_verifies_delivered_head: remediationVerifiesDeliveredHead,
    foreign_head_verification_fails_closed: foreignHeadFailsClosed,
  }

  const observed: ObservedBindings = {
    incidentId: incident.id,
    evidenceIds: incident.evidence.map(({ id }) => id),
    repository: incident.repository,
    sourceRun: {
      id: incident.sourceRun.id,
      attempt: incident.sourceRun.attempt,
      headSha: incident.sourceRun.headSha,
    },
    failedJob: failedJobEvidence
      ? {
        id: failedJobEvidence.jobId,
        name: failedJobEvidence.jobName,
        conclusion: failedJobEvidence.conclusion,
      }
      : null,
    failedStep: failedStepEvidence
      ? {
        number: failedStepEvidence.stepNumber,
        name: failedStepEvidence.stepName,
        conclusion: failedStepEvidence.conclusion,
      }
      : null,
    retry: retryResult
      ? {
        runId: retryResult.runId,
        runAttempt: retryResult.runAttempt,
        headSha: retryResult.headSha,
        conclusion: retryResult.conclusion,
      }
      : null,
    remediation: {
      verificationStatus: remediationRun.verification.status,
      verifiedHeadSha: remediationResult?.headSha ?? null,
      runId: remediationResult?.runId ?? null,
      incidentStatus: remediationRun.incident.status,
      ciResultMode: remediationRun.incident.ciResult?.mode ?? null,
    },
    foreignHead: {
      verificationStatus: foreignRun.verification.status,
      verificationErrorCode: foreignRun.verification.error?.code ?? null,
      incidentStatus: foreignRun.incident.status,
      ciResultMode: foreignRun.incident.ciResult?.mode ?? null,
    },
    githubWrites: [...positive.writes],
  }

  const allChecksPass = checkNames.every((name) => checks[name])
  const status = allChecksPass && hardFailures.size === 0 ? "passed" : "failed"

  return {
    schemaVersion: 1,
    suite: SUITE,
    fixtureFingerprint: fixtures.fixtureFingerprint,
    status,
    checks,
    hardFailures: [...hardFailures],
    observed,
    metadata: { ...metadata },
  }
}

export type { BuildIncidentCase, LoadedFixtures }
