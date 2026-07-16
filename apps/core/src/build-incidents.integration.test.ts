import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"
import type {
  CodexRuntime,
  CodexRuntimeEvent,
  StartCodexThreadInput,
} from "@podo/codex-app-server-client"
import type {
  BuildIncident,
  BuildIncidentAuditEvent,
  BuildIncidentRetry,
  BuildRemediationVerification,
  IncidentDelivery,
  IncidentRemediation,
} from "@podo/contracts"
import {
  GitHubActionsReadAdapter,
  GitHubActionsRetryAdapter,
  GitHubActionsWebhookDecoder,
  MAX_GITHUB_ACTIONS_WEBHOOK_BYTES,
  type GitHubActionsWebhookInput,
} from "@podo/plugin-github"
import { createPodoClient } from "../../../packages/client/src/index"

import { createCoreHandler } from "./app"
import type {
  IncidentRemediationExecutorInput,
} from "./modules/remediation/incident-remediation"
import type {
  PullRequestDeliveryInput,
} from "./modules/remediation/incident-delivery"

interface GitHubRunFixture {
  id: number
  workflow_id: number
  run_number: number
  run_attempt: number
  name: string
  path: string
  event: string
  head_branch: string | null
  head_sha: string
  status: string
  conclusion: string
  html_url: string
  created_at: string
  updated_at: string
  repository: {
    full_name: string
    name: string
    owner: { login: string }
  }
}

interface GitHubWrite {
  url: string
  method: string
  body: string | null
}

interface HttpResult<T> {
  response: Response
  body: T
}

const fixtureDirectory = new URL("../../../scenarios/github-actions-failure/fixtures/", import.meta.url)
const repositoryCwd = fileURLToPath(new URL("../../../", import.meta.url))
const webhookSecret = "uc13-fixture-webhook-secret"
const githubToken = "uc13-fixture-github-token"
const failureWebhookBody = readFixtureText("failure-webhook.json")
const failureRun = readFixtureJson<GitHubRunFixture>("failure-run.json")
const failureJobs = readFixtureJson<unknown>("failure-jobs.json")
const retrySuccessRun = readFixtureJson<GitHubRunFixture>("retry-success-run.json")
const remediationSuccessRun = readFixtureJson<GitHubRunFixture>("remediation-success-run.json")
const repository = {
  owner: failureRun.repository.owner.login,
  name: failureRun.repository.name,
}
const repositoryIdentity = `${repository.owner}/${repository.name}`
const runsPath = `/repos/${repository.owner}/${repository.name}/actions/runs`
const canonicalIncidentId = "build_incident_26ce94f5d1689e756c311741"
const canonicalEvidenceIds = [
  "build_evidence_5f30ba336df64238a39baf03",
  "build_evidence_468ea0c7316be8b06008fe71",
  "build_evidence_f25034b06ad510f3a028436b",
]

class DiagnosisRuntime implements CodexRuntime {
  private readonly listeners = new Set<(event: CodexRuntimeEvent) => void>()
  readonly threads: StartCodexThreadInput[] = []
  readonly prompts: string[] = []

  async startThread(input: StartCodexThreadInput) {
    this.threads.push(structuredClone(input))
    return { threadId: "uc13-build-thread" }
  }

  async resumeThread() { return { threadId: "uc13-build-thread" } }

  async startTurn(_threadId: string, prompt: string) {
    this.prompts.push(prompt)
    return { turnId: "uc13-build-turn" }
  }

  async steerTurn() { return { turnId: "uc13-build-turn" } }
  async interruptTurn() {}
  async resolveApproval() {}

  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  async close() {}
}

function createFixture(options: {
  decodeWebhook?: (input: GitHubActionsWebhookInput) => unknown
} = {}) {
  const runtime = new DiagnosisRuntime()
  const github = createFixtureGitHubTransport()
  const decoder = new GitHubActionsWebhookDecoder({ secret: webhookSecret, repository })
  const reader = new GitHubActionsReadAdapter({ token: githubToken, repository, fetch: github.fetch })
  const retry = new GitHubActionsRetryAdapter({ token: githubToken, repository, fetch: github.fetch })
  const executorInputs: IncidentRemediationExecutorInput[] = []
  const deliveryInputs: PullRequestDeliveryInput[] = []

  const handler = createCoreHandler({
    runtime,
    githubActions: {
      repository,
      repositoryCwd,
      operatorIdentity: "uc13-fixture-operator",
      verificationTimeoutMs: 60_000,
      decodeWebhook(input) { return options.decodeWebhook?.(input) ?? decoder.decode(input) },
      captureFailedRun(signal) { return reader.captureFailedRun(signal) },
      getCurrentRun(binding) { return reader.getCurrentRun(binding) },
      listRunsForHead(input) { return reader.listRunsForHead(input) },
      retryFailedJobs(input) { return retry.retryFailedJobs(input) },
    },
    remediationExecutor: {
      async execute(input) {
        executorInputs.push(structuredClone(input))
        const sourceHead = input.incident.expectedBaseCommit
        if (!sourceHead) throw new Error("expected source-bound build remediation")
        return {
          provenance: {
            baseRef: failureRun.head_branch ?? "main",
            baseCommit: sourceHead,
            resultTreeOid: "e".repeat(40),
          },
          patch: {
            summary: "Fix the deterministic workspace regression",
            changedFiles: ["packages/example/src/index.ts", "packages/example/src/index.test.ts"],
            unifiedDiff: [
              "diff --git a/packages/example/src/index.ts b/packages/example/src/index.ts",
              "-old",
              "+fixed",
              "diff --git a/packages/example/src/index.test.ts b/packages/example/src/index.test.ts",
              "-expect(regression).toFail()",
              "+expect(regression).toPass()",
            ].join("\n"),
          },
          regression: {
            test: "bun test packages/example",
            prePatch: "failed",
            postPatch: "passed",
          },
          validation: {
            status: "passed",
            checks: ["bun test packages/example", "bun run --cwd packages/example typecheck"],
          },
          pullRequestPreview: {
            title: "fix(workspace): repair deterministic regression",
            body: "Evidence-backed, red-green tested remediation.",
            baseBranch: failureRun.head_branch ?? "main",
            headBranch: remediationSuccessRun.head_branch ?? "podo/remediation-uc13",
          },
        }
      },
    },
    pullRequestDelivery: {
      expectedRepository: repositoryIdentity,
      operatorIdentity: "uc13-fixture-operator",
      port: {
        async deliver(input) {
          deliveryInputs.push(structuredClone(input))
          return {
            provider: "github",
            repository: repositoryIdentity,
            number: 42,
            url: `https://github.com/${repositoryIdentity}/pull/42`,
            baseCommit: input.artifact.provenance.baseCommit,
            baseBranch: input.artifact.pullRequestPreview.baseBranch,
            headBranch: input.artifact.pullRequestPreview.headBranch,
            headSha: remediationSuccessRun.head_sha,
            artifactId: input.artifact.pullRequestPreview.id,
            proof: {
              providerStatus: "created",
              idempotencyKey: input.deliveryId,
              resultTreeOid: input.artifact.provenance.resultTreeOid,
              patchSha256: input.artifact.patch.sha256,
              validationChecks: [...input.artifact.validation.checks],
              evidenceIds: [...input.artifact.evidenceIds],
              authorization: {
                approvalId: input.authorization.approvalId,
                approvedBy: input.authorization.approvedBy,
                approvedAt: input.authorization.approvedAt,
              },
            },
          }
        },
      },
    },
  })

  return { runtime, github, executorInputs, deliveryInputs, handler }
}

describe("UC-13 GitHub Actions Build Incident HTTP vertical slice", () => {
  test("rejects an unsigned provider payload before evidence capture", async () => {
    const fixture = createFixture()
    const rejected = await requestJson<{ error: string; message: string }>(
      fixture.handler,
      "/api/github/actions/workflow-runs",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "uc13-invalid-signature",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: failureWebhookBody,
      },
    )

    expect(rejected.response.status).toBe(401)
    expect(rejected.body).toEqual({
      error: "invalid_webhook",
      message: "GitHub Actions webhook was invalid",
    })
    expect(JSON.stringify(rejected.body)).not.toContain(webhookSecret)
    expect(fixture.runtime.threads).toEqual([])
    expect(fixture.github.writes).toEqual([])
    const incidents = await requestJson<{ incidents: BuildIncident[] }>(fixture.handler, "/api/build-incidents")
    expect(incidents.body.incidents).toEqual([])
  })

  test("rejects declared and streamed webhook bodies above 2 MiB before decoding", async () => {
    const decodedBodies: string[] = []
    const fixture = createFixture({
      decodeWebhook(input) {
        decodedBodies.push(input.body)
        throw new Error("oversized webhook reached decoder")
      },
    })
    const headers = {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "uc13-oversized-webhook",
      "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
    }

    const declared = await fixture.handler(new Request("http://podo.test/api/github/actions/workflow-runs", {
      method: "POST",
      headers: {
        ...headers,
        "content-length": String(MAX_GITHUB_ACTIONS_WEBHOOK_BYTES + 1),
      },
      body: "{}",
    }))
    expect(declared.status).toBe(422)
    expect(await declared.json()).toEqual({
      error: "invalid_webhook",
      message: "GitHub Actions webhook was invalid",
    })
    expect(decodedBodies).toEqual([])

    let pulls = 0
    let cancelled = false
    const chunk = new Uint8Array(1024 * 1024).fill(0x61)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(pulls <= 2 ? chunk : new Uint8Array([0x61]))
      },
      cancel() {
        cancelled = true
      },
    })
    const streamed = await fixture.handler(new Request("http://podo.test/api/github/actions/workflow-runs", {
      method: "POST",
      headers: {
        ...headers,
        "x-github-delivery": "uc13-oversized-streamed-webhook",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }))
    expect(streamed.status).toBe(422)
    expect(await streamed.json()).toEqual({
      error: "invalid_webhook",
      message: "GitHub Actions webhook was invalid",
    })
    expect(pulls).toBe(3)
    expect(cancelled).toBe(true)
    expect(decodedBodies).toEqual([])
    expect(fixture.runtime.threads).toEqual([])
    expect(fixture.github.writes).toEqual([])
  })

  test("signed failure webhook produces evidence and an approved idempotent retry verifies only attempt + 1", async () => {
    const fixture = createFixture()
    const incident = await captureDiagnosedIncident(fixture.handler, fixture.runtime, "uc13-retry-delivery")

    expect(incident).toMatchObject({
      status: "awaiting_action",
      detector: "github_actions_failure",
      provider: "github_actions",
      repository: repositoryIdentity,
      workflow: {
        id: failureRun.workflow_id,
        name: failureRun.name,
        path: failureRun.path,
      },
      sourceRun: {
        id: failureRun.id,
        attempt: failureRun.run_attempt,
        headSha: failureRun.head_sha,
        conclusion: "failure",
      },
      diagnosis: { status: "validated", safeToAttemptFix: true },
    })
    expect(incident.evidence.map(({ sourceType }) => sourceType)).toEqual([
      "github_actions_workflow_run",
      "github_actions_job",
      "github_actions_step",
    ])
    expect(incident.id).toBe(canonicalIncidentId)
    expect(evidenceIds(incident)).toEqual(canonicalEvidenceIds)
    const diagnosisEvidenceIds = incident.diagnosis?.status === "validated"
      ? incident.diagnosis.evidenceIds
      : []
    expect(diagnosisEvidenceIds).toEqual(evidenceIds(incident))
    expect(diagnosisEvidenceIds).not.toEqual(sortedEvidenceIds(incident))
    const client = createPodoClient({
      baseUrl: "http://podo.test",
      fetch: (input, init) => fixture.handler(new Request(input, init)),
    })
    expect((await client.listBuildIncidents()).incidents.map(({ id }) => id)).toEqual([incident.id])
    expect((await client.getBuildIncident(incident.id)).incident.id).toBe(incident.id)

    const started = await requestJson<{ incident: BuildIncident; retry: BuildIncidentRetry }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(incident.id)}/retry`,
      jsonInit("POST", {}),
    )
    expect(started.response.status).toBe(201)
    expect(started.body).toMatchObject({
      incident: { status: "retry_pending_approval" },
      retry: { status: "pending_approval", approval: { status: "pending" } },
    })
    expect(fixture.github.writes).toEqual([])

    const approvalPath = `/api/build-incidents/${encodeURIComponent(incident.id)}/retry/approvals/${encodeURIComponent(started.body.retry.approval.id)}`
    const approved = await requestJson<{ incident: BuildIncident; retry: BuildIncidentRetry }>(
      fixture.handler,
      approvalPath,
      jsonInit("POST", { decision: "approve" }),
    )
    expect(approved.response.status).toBe(200)
    expect(approved.body).toMatchObject({
      incident: { status: "verified", ciResult: { mode: "retry" } },
      retry: {
        status: "verified",
        approval: { status: "approved" },
        sourceRun: {
          id: failureRun.id,
          attempt: failureRun.run_attempt,
          headSha: failureRun.head_sha,
        },
        result: {
          mode: "retry",
          runId: failureRun.id,
          runAttempt: failureRun.run_attempt + 1,
          headSha: failureRun.head_sha,
          conclusion: "success",
        },
      },
    })
    expect(retrySuccessRun.run_attempt).toBe(failureRun.run_attempt + 1)
    expect(fixture.github.writes).toEqual([{
      url: `https://api.github.com${runsPath}/${failureRun.id}/rerun-failed-jobs`,
      method: "POST",
      body: JSON.stringify({ enable_debug_logging: false }),
    }])

    const repeated = await requestJson<{ incident: BuildIncident; retry: BuildIncidentRetry }>(
      fixture.handler,
      approvalPath,
      jsonInit("POST", { decision: "approve" }),
    )
    expect(repeated.response.status).toBe(200)
    expect(repeated.body).toEqual(approved.body)
    expect(fixture.github.writes).toHaveLength(1)

    const audit = await getBuildAudit(fixture.handler, incident.id)
    expect(audit.map(({ kind }) => kind)).toEqual([
      "build.signal_received",
      "build.evidence_captured",
      "build.incident_created",
      "investigation.requested",
      "investigation.started",
      "investigation.completed",
      "investigation.diagnosis_validated",
      "build.retry_requested",
      "build.retry_approval_decided",
      "build.retry_dispatch_attempted",
      "build.retry_dispatched",
      "build.retry_ci_result_observed",
      "build.retry_verified",
    ])
    expect(audit.find(({ kind }) => kind === "build.retry_dispatched")).toMatchObject({
      retryId: started.body.retry.id,
      approvalId: started.body.retry.approval.id,
      approvedBy: "uc13-fixture-operator",
      providerStatus: "accepted",
      repository: repositoryIdentity,
      idempotencyKey: started.body.retry.id,
      runId: failureRun.id,
      headSha: failureRun.head_sha,
      previousAttempt: failureRun.run_attempt,
      expectedRunAttempt: failureRun.run_attempt + 1,
    })
    expect(audit.find(({ kind }) => kind === "build.retry_approval_decided")).toMatchObject({
      retryId: started.body.retry.id,
      approvalId: started.body.retry.approval.id,
      decision: "approve",
      decidedBy: "uc13-fixture-operator",
    })
  })

  test("captures a later failed attempt as distinct evidence and verifies its approved retry", async () => {
    const fixture = createFixture()
    const first = await captureDiagnosedIncident(
      fixture.handler,
      fixture.runtime,
      "uc13-attempt-aware-first",
    )
    const laterAttempt = failureRun.run_attempt + 1
    fixture.github.setFailedAttempt(laterAttempt)
    const laterBody = failureWebhookBodyForAttempt(laterAttempt)
    const signature = `sha256=${createHmac("sha256", webhookSecret).update(laterBody).digest("hex")}`
    const captured = await requestJson<{ created: boolean; incident: BuildIncident }>(
      fixture.handler,
      "/api/github/actions/workflow-runs",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "workflow_run",
          "x-github-delivery": "uc13-attempt-aware-second",
          "x-hub-signature-256": signature,
        },
        body: laterBody,
      },
    )
    expect(captured.response.status).toBe(201)
    expect(captured.body.created).toBe(true)
    expect(captured.body.incident.id).not.toBe(first.id)
    expect(captured.body.incident.sourceRun).toMatchObject({
      id: failureRun.id,
      attempt: laterAttempt,
      headSha: failureRun.head_sha,
      conclusion: "failure",
    })
    expect(captured.body.incident.evidence).toHaveLength(3)
    expect(captured.body.incident.evidence.every(({ runAttempt }) => runAttempt === laterAttempt)).toBe(true)
    expect(evidenceIds(captured.body.incident)).not.toEqual(evidenceIds(first))
    expect(fixture.github.capturedAttempts).toEqual([failureRun.run_attempt, laterAttempt])

    completeDiagnosis(fixture.runtime, captured.body.incident)
    const diagnosed = await requestJson<{ incident: BuildIncident }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(captured.body.incident.id)}`,
    )
    expect(diagnosed.body.incident).toMatchObject({
      status: "awaiting_action",
      diagnosis: { status: "validated" },
    })

    const started = await requestJson<{ retry: BuildIncidentRetry }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(captured.body.incident.id)}/retry`,
      jsonInit("POST", {}),
    )
    expect(started.response.status).toBe(201)
    const approved = await requestJson<{ incident: BuildIncident; retry: BuildIncidentRetry }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(captured.body.incident.id)}/retry/approvals/${encodeURIComponent(started.body.retry.approval.id)}`,
      jsonInit("POST", { decision: "approve" }),
    )
    expect(approved.response.status).toBe(200)
    expect(approved.body).toMatchObject({
      incident: { status: "verified" },
      retry: {
        status: "verified",
        sourceRun: { id: failureRun.id, attempt: laterAttempt, headSha: failureRun.head_sha },
        result: {
          mode: "retry",
          runId: failureRun.id,
          runAttempt: laterAttempt + 1,
          headSha: failureRun.head_sha,
          conclusion: "success",
        },
      },
    })
    expect(fixture.github.writes).toHaveLength(1)
    expect((await getBuildAudit(fixture.handler, captured.body.incident.id)).map(({ kind }) => kind))
      .toEqual(expect.arrayContaining([
        "build.signal_received",
        "build.evidence_captured",
        "build.retry_dispatched",
        "build.retry_verified",
      ]))
  })

  test("approved tested remediation and fake PR delivery verify CI only for the exact delivered head", async () => {
    const fixture = createFixture()
    const incident = await captureDiagnosedIncident(fixture.handler, fixture.runtime, "uc13-remediation-delivery")

    const pendingRemediation = await requestJson<{ remediation: IncidentRemediation }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(incident.id)}/remediation`,
      jsonInit("POST", {}),
    )
    expect(pendingRemediation.response.status).toBe(201)
    expect(pendingRemediation.body.remediation).toMatchObject({
      status: "pending_approval",
      approval: { status: "pending" },
    })
    expect(fixture.executorInputs).toEqual([])

    const completedRemediation = await requestJson<{ remediation: IncidentRemediation }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(incident.id)}/remediation/approvals/${encodeURIComponent(pendingRemediation.body.remediation.approval.id)}`,
      jsonInit("POST", { decision: "approve" }),
    )
    expect(completedRemediation.response.status).toBe(200)
    expect(completedRemediation.body.remediation).toMatchObject({
      status: "completed",
      approval: { status: "approved" },
      artifact: {
        provenance: { baseCommit: failureRun.head_sha, resultTreeOid: "e".repeat(40) },
        evidenceIds: sortedEvidenceIds(incident),
        regression: { prePatch: "failed", postPatch: "passed" },
        validation: { status: "passed" },
      },
    })
    expect(fixture.executorInputs).toHaveLength(1)
    expect(fixture.executorInputs[0]).toMatchObject({
      incident: {
        id: incident.id,
        evidenceIds: evidenceIds(incident),
        expectedBaseCommit: failureRun.head_sha,
      },
      target: "isolated_checkout",
    })

    const pendingDelivery = await requestJson<{ delivery: IncidentDelivery }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(incident.id)}/remediation/delivery`,
      jsonInit("POST", {}),
    )
    expect(pendingDelivery.response.status).toBe(201)
    expect(pendingDelivery.body.delivery).toMatchObject({
      status: "pending_approval",
      approval: { status: "pending" },
      artifactId: completedRemediation.body.remediation.artifact?.pullRequestPreview.id,
    })
    expect(fixture.deliveryInputs).toEqual([])

    const delivered = await requestJson<{ delivery: IncidentDelivery }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(incident.id)}/remediation/delivery/approvals/${encodeURIComponent(pendingDelivery.body.delivery.approval.id)}`,
      jsonInit("POST", { decision: "approve" }),
    )
    expect(delivered.response.status).toBe(200)
    expect(delivered.body.delivery).toMatchObject({
      status: "delivered",
      approval: { status: "approved" },
      pullRequest: {
        repository: repositoryIdentity,
        baseCommit: failureRun.head_sha,
        headBranch: remediationSuccessRun.head_branch,
        headSha: remediationSuccessRun.head_sha,
        artifactId: completedRemediation.body.remediation.artifact?.pullRequestPreview.id,
        proof: {
          providerStatus: "created",
          idempotencyKey: pendingDelivery.body.delivery.id,
          resultTreeOid: "e".repeat(40),
          evidenceIds: sortedEvidenceIds(incident),
          authorization: {
            approvalId: pendingDelivery.body.delivery.approval.id,
            approvedBy: "uc13-fixture-operator",
          },
        },
      },
    })
    expect(fixture.deliveryInputs).toHaveLength(1)
    expect(fixture.deliveryInputs[0]).toMatchObject({
      incidentId: incident.id,
      remediationId: completedRemediation.body.remediation.id,
      artifact: {
        provenance: { baseCommit: failureRun.head_sha },
        regression: { prePatch: "failed", postPatch: "passed" },
      },
    })

    const verified = await requestJson<{ incident: BuildIncident; verification: BuildRemediationVerification }>(
      fixture.handler,
      `/api/build-incidents/${encodeURIComponent(incident.id)}/remediation/verification`,
      jsonInit("POST", {}),
    )
    expect(verified.response.status).toBe(201)
    expect(verified.body).toMatchObject({
      incident: { status: "verified", ciResult: { mode: "remediation" } },
      verification: {
        status: "verified",
        remediationId: completedRemediation.body.remediation.id,
        artifactId: completedRemediation.body.remediation.artifact?.pullRequestPreview.id,
        resultTreeOid: "e".repeat(40),
        headBranch: remediationSuccessRun.head_branch,
        headSha: remediationSuccessRun.head_sha,
        result: {
          mode: "remediation",
          artifactId: completedRemediation.body.remediation.artifact?.pullRequestPreview.id,
          runId: remediationSuccessRun.id,
          runAttempt: remediationSuccessRun.run_attempt,
          headSha: remediationSuccessRun.head_sha,
          conclusion: "success",
        },
      },
    })
    expect(fixture.github.listedHeads).toEqual([remediationSuccessRun.head_sha])
    expect(fixture.github.listedHeads).not.toContain(failureRun.head_sha)
    expect(fixture.github.writes).toEqual([])

    const audit = await getBuildAudit(fixture.handler, incident.id)
    expect(audit.map(({ kind }) => kind)).toEqual([
      "build.signal_received",
      "build.evidence_captured",
      "build.incident_created",
      "investigation.requested",
      "investigation.started",
      "investigation.completed",
      "investigation.diagnosis_validated",
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
    expect(audit.find(({ kind }) => kind === "build.remediation_ci_verification_started")).toMatchObject({
      remediationId: completedRemediation.body.remediation.id,
      artifactId: completedRemediation.body.remediation.artifact?.pullRequestPreview.id,
      resultTreeOid: "e".repeat(40),
      headBranch: remediationSuccessRun.head_branch,
      headSha: remediationSuccessRun.head_sha,
    })
    expect(audit.find(({ kind }) => kind === "build.remediation_delivered")).toMatchObject({
      deliveryId: pendingDelivery.body.delivery.id,
      remediationId: completedRemediation.body.remediation.id,
      artifactId: completedRemediation.body.remediation.artifact?.pullRequestPreview.id,
      approvalId: pendingDelivery.body.delivery.approval.id,
      approvedBy: "uc13-fixture-operator",
      provider: "github",
      repository: repositoryIdentity,
      pullRequestNumber: 42,
      providerStatus: "created",
      idempotencyKey: pendingDelivery.body.delivery.id,
      baseCommit: failureRun.head_sha,
      headBranch: remediationSuccessRun.head_branch,
      headSha: remediationSuccessRun.head_sha,
      resultTreeOid: "e".repeat(40),
      evidenceIds: sortedEvidenceIds(incident),
    })
  })

  test("keeps resolution branches exclusive and permits retry only after remediation denial", async () => {
    const retryFixture = createFixture()
    const retryIncident = await captureDiagnosedIncident(
      retryFixture.handler,
      retryFixture.runtime,
      "uc13-exclusive-retry",
    )
    const pendingRetry = await requestJson<{ retry: BuildIncidentRetry }>(
      retryFixture.handler,
      `/api/build-incidents/${encodeURIComponent(retryIncident.id)}/retry`,
      jsonInit("POST", {}),
    )
    expect(pendingRetry.response.status).toBe(201)

    const conflictingRemediation = await requestJson<{ error: string; message: string }>(
      retryFixture.handler,
      `/api/build-incidents/${encodeURIComponent(retryIncident.id)}/remediation`,
      jsonInit("POST", {}),
    )
    expect(conflictingRemediation.response.status).toBe(409)
    expect(conflictingRemediation.body).toMatchObject({ error: "resolution_in_progress" })
    expect(retryFixture.executorInputs).toEqual([])
    expect(retryFixture.github.writes).toEqual([])
    expect((await getBuildAudit(retryFixture.handler, retryIncident.id)).map(({ kind }) => kind))
      .not.toContain("build.remediation_requested")

    const remediationFixture = createFixture()
    const remediationIncident = await captureDiagnosedIncident(
      remediationFixture.handler,
      remediationFixture.runtime,
      "uc13-denied-remediation-fallback",
    )
    const pendingRemediation = await requestJson<{ remediation: IncidentRemediation }>(
      remediationFixture.handler,
      `/api/build-incidents/${encodeURIComponent(remediationIncident.id)}/remediation`,
      jsonInit("POST", {}),
    )
    expect(pendingRemediation.response.status).toBe(201)
    const denied = await requestJson<{ remediation: IncidentRemediation }>(
      remediationFixture.handler,
      `/api/build-incidents/${encodeURIComponent(remediationIncident.id)}/remediation/approvals/${encodeURIComponent(pendingRemediation.body.remediation.approval.id)}`,
      jsonInit("POST", { decision: "deny" }),
    )
    expect(denied.response.status).toBe(200)
    expect(denied.body.remediation).toMatchObject({
      status: "denied",
      approval: { status: "denied" },
    })

    const fallbackRetry = await requestJson<{ incident: BuildIncident; retry: BuildIncidentRetry }>(
      remediationFixture.handler,
      `/api/build-incidents/${encodeURIComponent(remediationIncident.id)}/retry`,
      jsonInit("POST", {}),
    )
    expect(fallbackRetry.response.status).toBe(201)
    expect(fallbackRetry.body).toMatchObject({
      incident: { status: "retry_pending_approval" },
      retry: { status: "pending_approval", approval: { status: "pending" } },
    })
    expect(remediationFixture.executorInputs).toEqual([])
    expect(remediationFixture.github.writes).toEqual([])
    expect((await getBuildAudit(remediationFixture.handler, remediationIncident.id)).map(({ kind }) => kind))
      .toEqual(expect.arrayContaining([
        "build.remediation_requested",
        "build.remediation_approval_decided",
        "build.retry_requested",
      ]))
  })
})

async function captureDiagnosedIncident(
  handler: ReturnType<typeof createCoreHandler>,
  runtime: DiagnosisRuntime,
  deliveryId: string,
): Promise<BuildIncident> {
  const settings = await requestJson<{ settings: { autonomyMode: string } }>(
    handler,
    "/api/settings",
    jsonInit("PATCH", { autonomyMode: "act_with_approval" }),
  )
  expect(settings.response.status).toBe(200)
  expect(settings.body.settings.autonomyMode).toBe("act_with_approval")

  const signature = `sha256=${createHmac("sha256", webhookSecret).update(failureWebhookBody).digest("hex")}`
  const captured = await requestJson<{ created: boolean; incident: BuildIncident }>(
    handler,
    "/api/github/actions/workflow-runs",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": signature,
      },
      body: failureWebhookBody,
    },
  )
  expect(captured.response.status).toBe(201)
  expect(captured.body.created).toBe(true)
  expect(captured.body.incident.status).toBe("investigating")
  expect(runtime.threads).toEqual([expect.objectContaining({ cwd: repositoryCwd, sandbox: "read-only" })])
  expect(runtime.prompts).toHaveLength(1)
  expect(runtime.prompts[0]).toContain(String(failureRun.id))

  completeDiagnosis(runtime, captured.body.incident)
  const diagnosed = await requestJson<{ incident: BuildIncident }>(
    handler,
    `/api/build-incidents/${encodeURIComponent(captured.body.incident.id)}`,
  )
  expect(diagnosed.response.status).toBe(200)
  expect(diagnosed.body.incident).toMatchObject({
    status: "awaiting_action",
    investigation: { status: "completed" },
    diagnosis: { status: "validated" },
  })
  return diagnosed.body.incident
}

function completeDiagnosis(runtime: DiagnosisRuntime, incident: BuildIncident): void {
  runtime.emit({
    kind: "output.delta",
    threadId: "uc13-build-thread",
    turnId: "uc13-build-turn",
    text: JSON.stringify({
      schemaVersion: "podo.diagnosis.v1",
      summary: "The workspace job failed in its deterministic regression step",
      affectedService: incident.affectedService,
      probableRootCause: "A repository change introduced a deterministic workspace test failure",
      confidence: { value: 9400, scale: "basis_points" },
      // Preserve the evidence timeline order from Core. The remediation
      // artifact canonicalizes this set independently, so verification must
      // not depend on a model returning lexicographically sorted ids.
      evidenceIds: evidenceIds(incident),
      recommendedAction: "Retry once if appropriate or deliver the red-green tested remediation",
      safeToAttemptFix: true,
    }),
  })
  runtime.emit({
    kind: "turn.completed",
    threadId: "uc13-build-thread",
    turnId: "uc13-build-turn",
    status: "completed",
  })
}

function evidenceIds(incident: BuildIncident): string[] {
  return incident.evidence.map(({ id }) => id)
}

function sortedEvidenceIds(incident: BuildIncident): string[] {
  return evidenceIds(incident).sort()
}

function createFixtureGitHubTransport() {
  let currentRun = structuredClone(failureRun)
  let currentJobs = structuredClone(failureJobs)
  const writes: GitHubWrite[] = []
  const listedHeads: string[] = []
  const capturedAttempts: number[] = []

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(input.toString(), init)
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if (method === "GET" && url.pathname === `${runsPath}/${failureRun.id}`) {
      return Response.json(currentRun)
    }
    if (method === "GET"
      && url.pathname === `${runsPath}/${failureRun.id}/attempts/${currentRun.run_attempt}/jobs`
      && currentRun.conclusion === "failure") {
      capturedAttempts.push(currentRun.run_attempt)
      return Response.json(currentJobs)
    }
    if (method === "POST" && url.pathname === `${runsPath}/${failureRun.id}/rerun-failed-jobs`) {
      writes.push({
        url: url.toString(),
        method,
        body: await request.text() || null,
      })
      currentRun = {
        ...retrySuccessRun,
        run_attempt: currentRun.run_attempt + 1,
      }
      return new Response(null, { status: 201 })
    }
    if (method === "GET" && url.pathname === runsPath) {
      const headSha = url.searchParams.get("head_sha") ?? ""
      listedHeads.push(headSha)
      return Response.json(headSha === remediationSuccessRun.head_sha
        ? { total_count: 1, workflow_runs: [remediationSuccessRun] }
        : { total_count: 0, workflow_runs: [] })
    }
    throw new Error(`unexpected fixture GitHub request: ${method} ${url.pathname}`)
  }

  return {
    fetch,
    writes,
    listedHeads,
    capturedAttempts,
    setFailedAttempt(attempt: number) {
      currentRun = {
        ...failureRun,
        run_attempt: attempt,
        updated_at: `2026-07-16T08:${String(attempt).padStart(2, "0")}:00Z`,
      }
      currentJobs = failureJobsForAttempt(attempt)
    },
  }
}

function failureWebhookBodyForAttempt(attempt: number): string {
  const payload = JSON.parse(failureWebhookBody) as { workflow_run: GitHubRunFixture }
  payload.workflow_run = {
    ...payload.workflow_run,
    run_attempt: attempt,
    updated_at: `2026-07-16T08:${String(attempt).padStart(2, "0")}:00Z`,
  }
  return JSON.stringify(payload)
}

function failureJobsForAttempt(attempt: number): unknown {
  const payload = structuredClone(failureJobs) as { jobs: Array<Record<string, unknown>> }
  payload.jobs = payload.jobs.map((job) => ({ ...job, run_attempt: attempt }))
  return payload
}

async function getBuildAudit(
  handler: ReturnType<typeof createCoreHandler>,
  incidentId: string,
): Promise<BuildIncidentAuditEvent[]> {
  const result = await requestJson<{ events: BuildIncidentAuditEvent[] }>(
    handler,
    `/api/build-incidents/${encodeURIComponent(incidentId)}/audit`,
  )
  expect(result.response.status).toBe(200)
  expect(result.body.events.map(({ sequence }) => sequence)).toEqual(
    result.body.events.map((_, index) => index + 1),
  )
  return result.body.events
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

async function requestJson<T>(
  handler: ReturnType<typeof createCoreHandler>,
  path: string,
  init?: RequestInit,
): Promise<HttpResult<T>> {
  const response = await handler(new Request(`http://podo.test${path}`, init))
  return { response, body: await response.json() as T }
}

function readFixtureText(name: string): string {
  return readFileSync(new URL(name, fixtureDirectory), "utf8")
}

function readFixtureJson<T>(name: string): T {
  return JSON.parse(readFixtureText(name)) as T
}
