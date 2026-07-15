import { describe, expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent } from "@podo/codex-app-server-client"

import { createPodoClient } from "../../../../../packages/client/src/index"
import { createCoreHandler } from "../../app"
import { createProductionRemediationExecutorFactory } from "../../runtime/production-remediation"
import type { IssueDeliveryInput } from "./incident-issue"

const productionRemediationEnvironment = {
  PODO_REMEDIATION_ENABLED: "true",
  PODO_REMEDIATION_REPOSITORY_ROOT: "/repo",
  PODO_REMEDIATION_BASE_REF: "refs/heads/main",
  PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH: "main",
  PODO_REMEDIATION_SCRATCH_PARENT: "/scratch",
  PODO_REMEDIATION_REGRESSION_COMMAND: '["bun","test","demo/services/checkout-service"]',
  PODO_REMEDIATION_VALIDATION_COMMANDS: '[["bun","run","typecheck"],["bun","test"]]',
  PODO_REMEDIATION_COMMAND_TIMEOUT_MS: "120000",
  PODO_REMEDIATION_TURN_TIMEOUT_MS: "90000",
  PODO_REMEDIATION_MAX_OUTPUT_BYTES: "524288",
} as const

class DiagnosisRuntime implements CodexRuntime {
  private readonly listeners = new Set<(event: CodexRuntimeEvent) => void>()

  async startThread() { return { threadId: "private-thread" } }
  async resumeThread() { return { threadId: "private-thread" } }
  async startTurn() { return { turnId: "private-turn" } }
  async steerTurn() { return { turnId: "private-turn" } }
  async interruptTurn() {}
  async resolveApproval() {}
  onEvent(listener: (event: CodexRuntimeEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  emit(event: CodexRuntimeEvent) { for (const listener of this.listeners) listener(event) }
  async close() {}
}

function telemetry() {
  const base = Date.parse("2026-07-14T09:00:00.000Z")
  return [
    ...[180, 310, 450, 620].map((mib, step) => ({
      timestamp: new Date(base + step * 1_000).toISOString(),
      kind: "metric" as const,
      service: "checkout-service",
      severity: "warn" as const,
      message: "process heap sample",
      deploymentId: "deploy-1042",
      metric: { name: "process.heap.used", value: mib * 1024 * 1024, unit: "By" },
    })),
    {
      timestamp: new Date(base + 4_000).toISOString(),
      kind: "trace" as const,
      service: "checkout-service",
      severity: "error" as const,
      message: "POST /checkout returned 500",
      deploymentId: "deploy-1042",
      traceId: "trace-1",
    },
    {
      timestamp: new Date(base + 5_000).toISOString(),
      kind: "log" as const,
      service: "checkout-service",
      severity: "error" as const,
      message: "JavaScript heap out of memory",
      deploymentId: "deploy-1042",
      traceId: "trace-2",
    },
  ]
}

function completeDiagnosis(
  runtime: DiagnosisRuntime,
  evidenceIds: string[],
  safeToAttemptFix = true,
  overrides: Partial<{
    summary: string
    probableRootCause: string
    recommendedAction: string
  }> = {},
): void {
  const output = JSON.stringify({
    schemaVersion: "podo.diagnosis.v1",
    summary: "Heap growth correlates with checkout failures",
    affectedService: "checkout-service",
    probableRootCause: "The deployed cache retains entries without a bound",
    confidence: { value: 9000, scale: "basis_points" },
    evidenceIds,
    recommendedAction: "Bound the cache and add a regression test",
    safeToAttemptFix,
    ...overrides,
  })
  runtime.emit({ kind: "output.delta", threadId: "private-thread", turnId: "private-turn", text: output })
  runtime.emit({ kind: "turn.completed", threadId: "private-thread", turnId: "private-turn", status: "completed" })
}

function issueResult(input: IssueDeliveryInput, number: number, state: "open" | "closed" = "open") {
  return {
    provider: "github" as const,
    status: "created" as const,
    repository: "reseaxch/podo",
    number,
    url: `https://github.com/reseaxch/podo/issues/${number}`,
    state,
    draft: {
      id: input.draft.id,
      idempotencyKey: input.draft.idempotencyKey,
      contentSha256: input.draft.contentSha256,
    },
    authorization: {
      id: input.authorization.authorizationId,
      authorizedAt: input.authorization.authorizedAt,
    },
    incident: {
      id: input.draft.content.incidentId,
      reason: input.draft.content.reason,
      evidenceIds: [...input.draft.content.evidenceIds],
    },
  }
}

function verifiedExecutorResult() {
  return {
    provenance: {
      baseRef: "main",
      baseCommit: "a".repeat(40),
      resultTreeOid: "b".repeat(40),
    },
    patch: {
      summary: "Bound checkout cache retention",
      changedFiles: ["demo/services/checkout-service/src/cache.ts"],
      unifiedDiff: "diff --git a/demo/services/checkout-service/src/cache.ts b/demo/services/checkout-service/src/cache.ts\n-old\n+bounded",
    },
    regression: {
      test: "checkout cache remains bounded",
      prePatch: "failed" as const,
      postPatch: "passed" as const,
    },
    validation: { status: "passed" as const, checks: ["core-tests", "typecheck"] },
    pullRequestPreview: {
      title: "fix(checkout): bound cache retention",
      body: "Adds a bounded retention policy and regression coverage.",
      baseBranch: "main",
      headBranch: "podo/fix-checkout-cache",
    },
  }
}

async function createValidatedFixture(
  executor: { execute(input: unknown): Promise<unknown> } | undefined,
  options: { mode?: "observe" | "recommend" | "act_with_approval"; safeToAttemptFix?: boolean } = {},
) {
  const runtime = new DiagnosisRuntime()
  const handler = createCoreHandler({ runtime, ...(executor ? { remediationExecutor: executor } : {}) })
  const client = createPodoClient({
    baseUrl: "http://podo.test",
    fetch: (input, init) => handler(new Request(input, init)),
  })
  const ingested = await client.ingestTelemetry(telemetry())
  if (!ingested.incident) throw new Error("expected incident")
  await client.updateSettings({ autonomyMode: options.mode ?? "act_with_approval" })
  const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
  completeDiagnosis(
    runtime,
    investigation.incident.evidence.map(({ id }) => id),
    options.safeToAttemptFix ?? true,
  )
  return { runtime, handler, client, incident: ingested.incident }
}

async function createProductionCompositionFixture(executorResult: unknown) {
  const runtime = new DiagnosisRuntime()
  const metrics = {
    runtimeAcquisitions: 0,
    producerCreations: 0,
    executorCreations: 0,
    executorInputs: [] as unknown[],
    producerRuntimes: [] as CodexRuntime[],
  }
  const productionFactory = createProductionRemediationExecutorFactory(productionRemediationEnvironment, {
    createProducer(config) {
      metrics.producerCreations += 1
      metrics.producerRuntimes.push(config.runtime)
      return { async writeRegression() {}, async applyFix() {} }
    },
    createExecutor() {
      metrics.executorCreations += 1
      return {
        async execute(input) {
          metrics.executorInputs.push(input)
          return executorResult
        },
      }
    },
  })
  if (!productionFactory) throw new Error("expected production remediation factory")

  const handler = createCoreHandler({
    runtime,
    remediationExecutorFactory(runtimeProvider) {
      return productionFactory(async () => {
        metrics.runtimeAcquisitions += 1
        return runtimeProvider()
      })
    },
  })
  const client = createPodoClient({
    baseUrl: "http://podo.test",
    fetch: (input, init) => handler(new Request(input, init)),
  })
  const ingested = await client.ingestTelemetry(telemetry())
  if (!ingested.incident) throw new Error("expected incident")
  await client.updateSettings({ autonomyMode: "act_with_approval" })
  const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
  completeDiagnosis(runtime, investigation.incident.evidence.map(({ id }) => id))
  return { runtime, client, incident: ingested.incident, metrics }
}

describe("incident remediation API", () => {
  test("creates one GitHub issue fallback for a validated diagnosis that is unsafe to remediate", async () => {
    const runtime = new DiagnosisRuntime()
    const delivered: unknown[] = []
    const handler = createCoreHandler({
      runtime,
      issueDelivery: {
        expectedRepository: "reseaxch/podo",
        port: {
          async create(input: IssueDeliveryInput) {
            delivered.push(input)
            return issueResult(input, 91)
          },
        },
      },
    })
    const client = createPodoClient({
      baseUrl: "http://podo.test",
      fetch: (input, init) => handler(new Request(input, init)),
    })
    const ingested = await client.ingestTelemetry(telemetry())
    if (!ingested.incident) throw new Error("expected incident")
    await client.updateSettings({ autonomyMode: "recommend" })
    const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
    completeDiagnosis(runtime, investigation.incident.evidence.map(({ id }) => id), false)

    const first = await client.startIncidentIssue(ingested.incident.id)
    const repeated = await client.startIncidentIssue(ingested.incident.id)

    expect(repeated).toEqual(first)
    expect(first.issueDelivery).toMatchObject({
      status: "created",
      reason: "remediation_not_safe",
      issue: { provider: "github", repository: "reseaxch/podo", number: 91 },
    })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      authorization: { kind: "core.issue_fallback.v1" },
      draft: {
        id: expect.stringMatching(/^issue_draft_/),
        content: { incidentId: ingested.incident.id, reason: "remediation_not_safe" },
      },
    })
    expect(JSON.stringify(delivered[0])).toContain(investigation.incident.evidence[0]!.id)
    expect(JSON.stringify(delivered[0])).not.toContain("unifiedDiff")
    expect((await client.getIncidentAudit(ingested.incident.id)).events.slice(-2).map(({ kind }) => kind)).toEqual([
      "issue.requested",
      "issue.succeeded",
    ])
  })

  test("rejects confidential diagnosis content before any issue provider call", async () => {
    const runtime = new DiagnosisRuntime()
    let issueCreates = 0
    const handler = createCoreHandler({
      runtime,
      issueDelivery: {
        expectedRepository: "reseaxch/podo",
        port: {
          async create(input: IssueDeliveryInput) {
            issueCreates++
            return issueResult(input, 94)
          },
        },
      },
    })
    const client = createPodoClient({ baseUrl: "http://podo.test", fetch: (input, init) => handler(new Request(input, init)) })
    const ingested = await client.ingestTelemetry(telemetry())
    if (!ingested.incident) throw new Error("expected incident")
    await client.updateSettings({ autonomyMode: "recommend" })
    const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
    completeDiagnosis(runtime, investigation.incident.evidence.map(({ id }) => id), false, {
      probableRootCause: "Cache key CANARY_SECRET_42 was retained without a bound",
    })

    await expect(client.startIncidentIssue(ingested.incident.id)).rejects.toThrow("confidential_content")

    expect(issueCreates).toBe(0)
    const audit = await client.getIncidentAudit(ingested.incident.id)
    expect(JSON.stringify(audit)).not.toContain("CANARY_SECRET_42")
    expect(audit.events.some(({ kind }) => kind === "issue.requested")).toBe(false)
  })

  test("fails closed when provider result is not exactly bound to the sealed draft", async () => {
    const runtime = new DiagnosisRuntime()
    const handler = createCoreHandler({
      runtime,
      issueDelivery: {
        expectedRepository: "reseaxch/podo",
        port: {
          async create(input: IssueDeliveryInput) {
            return issueResult(input, 95, "closed")
          },
        },
      },
    })
    const client = createPodoClient({ baseUrl: "http://podo.test", fetch: (input, init) => handler(new Request(input, init)) })
    const ingested = await client.ingestTelemetry(telemetry())
    if (!ingested.incident) throw new Error("expected incident")
    await client.updateSettings({ autonomyMode: "recommend" })
    const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
    completeDiagnosis(runtime, investigation.incident.evidence.map(({ id }) => id), false)

    const fallback = await client.startIncidentIssue(ingested.incident.id)

    expect(fallback.issueDelivery).toMatchObject({
      status: "failed",
      error: { code: "invalid_delivery_result" },
    })
    expect(fallback.issueDelivery.issue).toBeUndefined()
  })

  test("routes failed remediation validation to issue instead of pull request delivery", async () => {
    const runtime = new DiagnosisRuntime()
    let issueCreates = 0
    const handler = createCoreHandler({
      runtime,
      remediationExecutor: {
        async execute() {
          return {
            ...verifiedExecutorResult(),
            validation: { status: "failed", checks: ["core-tests"] },
          }
        },
      },
      issueDelivery: {
        expectedRepository: "reseaxch/podo",
        port: {
          async create(input: IssueDeliveryInput) {
            issueCreates++
            return issueResult(input, 93)
          },
        },
      },
    })
    const client = createPodoClient({ baseUrl: "http://podo.test", fetch: (input, init) => handler(new Request(input, init)) })
    const ingested = await client.ingestTelemetry(telemetry())
    if (!ingested.incident) throw new Error("expected incident")
    await client.updateSettings({ autonomyMode: "act_with_approval" })
    const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
    completeDiagnosis(runtime, investigation.incident.evidence.map(({ id }) => id), true)
    const pending = await client.startIncidentRemediation(ingested.incident.id)
    const failed = await client.approveIncidentRemediation(ingested.incident.id, pending.remediation.approval.id)
    expect(failed.remediation).toMatchObject({ status: "failed", error: { code: "verification_failed" } })

    const fallback = await client.startIncidentIssue(ingested.incident.id)

    expect(fallback.issueDelivery).toMatchObject({
      status: "created",
      reason: "remediation_failed",
      issue: { number: 93 },
    })
    expect(issueCreates).toBe(1)
    await expect(client.startIncidentDelivery(ingested.incident.id)).rejects.toThrow("remediation_not_verified")
  })
  test("keeps the production composition seam approval-gated, idempotent, and artifact-safe", async () => {
    const deniedFixture = await createProductionCompositionFixture(verifiedExecutorResult())
    const deniedPending = await deniedFixture.client.startIncidentRemediation(deniedFixture.incident.id)

    expect(deniedFixture.metrics).toMatchObject({
      runtimeAcquisitions: 0,
      producerCreations: 0,
      executorCreations: 0,
      executorInputs: [],
    })
    expect((await deniedFixture.client.getIncidentRemediationAudit(deniedFixture.incident.id)).events).toMatchObject([
      { sequence: 1, kind: "remediation.requested" },
    ])
    const denied = await deniedFixture.client.denyIncidentRemediation(
      deniedFixture.incident.id,
      deniedPending.remediation.approval.id,
    )
    const repeatedDenial = await deniedFixture.client.denyIncidentRemediation(
      deniedFixture.incident.id,
      deniedPending.remediation.approval.id,
    )
    expect(repeatedDenial).toEqual(denied)
    expect(deniedFixture.metrics).toMatchObject({
      runtimeAcquisitions: 0,
      producerCreations: 0,
      executorCreations: 0,
      executorInputs: [],
    })
    expect((await deniedFixture.client.getIncidentRemediationAudit(deniedFixture.incident.id)).events).toMatchObject([
      { sequence: 1, kind: "remediation.requested" },
      { sequence: 2, kind: "remediation.approval_decided", decision: "deny" },
    ])

    const failedFixture = await createProductionCompositionFixture({
      ...verifiedExecutorResult(),
      validation: { status: "failed", checks: ["workspace-check"] },
      pullRequestPreview: {
        ...verifiedExecutorResult().pullRequestPreview,
        body: "should-never-publish",
      },
    })
    const failedPending = await failedFixture.client.startIncidentRemediation(failedFixture.incident.id)
    expect(failedFixture.metrics.runtimeAcquisitions).toBe(0)
    expect(failedFixture.metrics.executorInputs).toHaveLength(0)

    const [firstApproval, repeatedApproval] = await Promise.all([
      failedFixture.client.approveIncidentRemediation(
        failedFixture.incident.id,
        failedPending.remediation.approval.id,
      ),
      failedFixture.client.approveIncidentRemediation(
        failedFixture.incident.id,
        failedPending.remediation.approval.id,
      ),
    ])

    expect(repeatedApproval).toEqual(firstApproval)
    expect(failedFixture.metrics).toMatchObject({
      runtimeAcquisitions: 1,
      producerCreations: 1,
      executorCreations: 1,
    })
    expect(failedFixture.metrics.executorInputs).toHaveLength(1)
    expect(failedFixture.metrics.producerRuntimes).toEqual([failedFixture.runtime])
    expect(firstApproval.remediation).toMatchObject({
      status: "failed",
      approval: { status: "approved" },
      error: { code: "verification_failed" },
    })
    expect(firstApproval.remediation.artifact).toBeUndefined()
    expect(JSON.stringify(firstApproval)).not.toContain("should-never-publish")
    expect(JSON.stringify(firstApproval)).not.toContain("unifiedDiff")
    const failedAudit = await failedFixture.client.getIncidentRemediationAudit(failedFixture.incident.id)
    expect(failedAudit.events).toMatchObject([
      { sequence: 1, kind: "remediation.requested" },
      { sequence: 2, kind: "remediation.approval_decided", decision: "approve" },
      { sequence: 3, kind: "remediation.execution_started" },
      { sequence: 4, kind: "remediation.verification_failed", code: "verification_failed" },
    ])
    expect(JSON.stringify(failedAudit)).not.toContain("should-never-publish")
    expect(JSON.stringify(failedAudit)).not.toContain("unifiedDiff")
  })

  test("waits for explicit approval and exposes only a verified sanitized artifact", async () => {
    const runtime = new DiagnosisRuntime()
    const executorCalls: unknown[] = []
    const executor = {
      async execute(input: unknown) {
        executorCalls.push(input)
        return verifiedExecutorResult()
      },
    }
    const handler = createCoreHandler({ runtime, remediationExecutor: executor })
    const client = createPodoClient({
      baseUrl: "http://podo.test",
      fetch: (input, init) => handler(new Request(input, init)),
    })
    const ingested = await client.ingestTelemetry(telemetry())
    if (!ingested.incident) throw new Error("expected incident")
    await client.updateSettings({ autonomyMode: "act_with_approval" })
    const investigation = await client.startIncidentInvestigation(ingested.incident.id, { cwd: "/repo" })
    completeDiagnosis(runtime, investigation.incident.evidence.map(({ id }) => id))

    const pending = await client.startIncidentRemediation(ingested.incident.id)

    expect(pending.remediation).toMatchObject({
      incidentId: ingested.incident.id,
      status: "pending_approval",
      target: "isolated_checkout",
      approval: { status: "pending" },
    })
    expect(executorCalls).toHaveLength(0)

    const completed = await client.approveIncidentRemediation(
      ingested.incident.id,
      pending.remediation.approval.id,
    )

    expect(executorCalls).toHaveLength(1)
    expect(executorCalls[0]).toMatchObject({
      incident: {
        id: ingested.incident.id,
        affectedService: "checkout-service",
        diagnosis: { status: "validated", safeToAttemptFix: true },
      },
      target: "isolated_checkout",
      policy: { allowedTools: expect.arrayContaining(["apply_patch", "run_test"]) },
    })
    expect(completed.remediation).toMatchObject({
      id: pending.remediation.id,
      status: "completed",
      approval: { id: pending.remediation.approval.id, status: "approved" },
      artifact: {
        provenance: {
          baseRef: "main",
          baseCommit: "a".repeat(40),
          resultTreeOid: "b".repeat(40),
        },
        evidenceIds: [...investigation.incident.evidence.map(({ id }) => id)].sort(),
        patch: {
          summary: "Bound checkout cache retention",
          changedFiles: ["demo/services/checkout-service/src/cache.ts"],
          unifiedDiff: "diff --git a/demo/services/checkout-service/src/cache.ts b/demo/services/checkout-service/src/cache.ts\n-old\n+bounded",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        regression: { test: "checkout cache remains bounded", prePatch: "failed", postPatch: "passed" },
        validation: { status: "passed", checks: ["core-tests", "typecheck"] },
        pullRequestPreview: {
          id: expect.stringMatching(/^pr_preview_[a-f0-9]{24}$/),
          title: "fix(checkout): bound cache retention",
          baseBranch: "main",
          headBranch: "podo/fix-checkout-cache",
        },
      },
    })
    const serialized = JSON.stringify(completed)
    expect(serialized).not.toContain("private-thread")
    expect((await client.getIncidentRemediationAudit(ingested.incident.id)).events).toMatchObject([
      { sequence: 1, kind: "remediation.requested" },
      { sequence: 2, kind: "remediation.approval_decided", decision: "approve" },
      { sequence: 3, kind: "remediation.execution_started" },
      {
        sequence: 4,
        kind: "remediation.verification_succeeded",
        artifactId: completed.remediation.artifact!.pullRequestPreview.id,
      },
    ])
  })

  test("denial is terminal, idempotent, and never invokes the executor", async () => {
    const calls: unknown[] = []
    const { client, handler, incident } = await createValidatedFixture({
      async execute(input) { calls.push(input); return verifiedExecutorResult() },
    })
    const pending = await client.startIncidentRemediation(incident.id)
    expect(JSON.stringify(pending)).not.toContain("unifiedDiff")

    const denied = await client.denyIncidentRemediation(incident.id, pending.remediation.approval.id)
    const repeated = await client.denyIncidentRemediation(incident.id, pending.remediation.approval.id)

    expect(denied.remediation).toMatchObject({ status: "denied", approval: { status: "denied" } })
    expect(repeated).toEqual(denied)
    expect(calls).toHaveLength(0)
    expect(JSON.stringify(denied)).not.toContain("unifiedDiff")
    await expect(client.approveIncidentRemediation(incident.id, pending.remediation.approval.id)).rejects.toThrow("409")

    const injected = await handler(new Request(`http://podo.test/api/incidents/${incident.id}/remediation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diagnosis: { status: "validated" } }),
    }))
    expect(injected.status).toBe(400)
  })

  test("rejects a claimed success when the regression did not pass after the patch", async () => {
    const { client, incident } = await createValidatedFixture({
      async execute() {
        return {
          ...verifiedExecutorResult(),
          regression: {
            test: "checkout cache remains bounded",
            prePatch: "failed",
            postPatch: "failed",
          },
        }
      },
    })
    const pending = await client.startIncidentRemediation(incident.id)
    const failed = await client.approveIncidentRemediation(incident.id, pending.remediation.approval.id)

    expect(failed.remediation).toMatchObject({
      status: "failed",
      approval: { status: "approved" },
      error: { code: "verification_failed" },
    })
    expect(failed.remediation.artifact).toBeUndefined()
    expect(JSON.stringify(failed)).not.toContain("unifiedDiff")
    expect(JSON.stringify(failed)).not.toContain("Adds a bounded retention policy")
    expect(await client.getIncidentRemediation(incident.id)).toEqual(failed)
  })

  test("deduplicates concurrent starts and approvals and executes exactly once", async () => {
    let release!: (value: unknown) => void
    const gate = new Promise<unknown>((resolve) => { release = resolve })
    const calls: unknown[] = []
    const { client, incident } = await createValidatedFixture({
      async execute(input) { calls.push(input); return gate },
    })

    const [firstStart, secondStart] = await Promise.all([
      client.startIncidentRemediation(incident.id),
      client.startIncidentRemediation(incident.id),
    ])
    expect(secondStart.remediation.id).toBe(firstStart.remediation.id)
    expect(secondStart.remediation.approval.id).toBe(firstStart.remediation.approval.id)

    const firstApproval = client.approveIncidentRemediation(incident.id, firstStart.remediation.approval.id)
    const secondApproval = client.approveIncidentRemediation(incident.id, firstStart.remediation.approval.id)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    release(verifiedExecutorResult())
    const [firstCompleted, secondCompleted] = await Promise.all([firstApproval, secondApproval])

    expect(firstCompleted.remediation.status).toBe("completed")
    expect(secondCompleted).toEqual(firstCompleted)
    expect(calls).toHaveLength(1)
    const repeatedApproval = await client.approveIncidentRemediation(incident.id, firstStart.remediation.approval.id)
    expect(repeatedApproval).toEqual(firstCompleted)
    expect(calls).toHaveLength(1)
  })

  test("fails closed without a validated safe diagnosis, active mode, or executor", async () => {
    const executor = { async execute() { return verifiedExecutorResult() } }

    const unsafe = await createValidatedFixture(executor, { safeToAttemptFix: false })
    await expect(unsafe.client.startIncidentRemediation(unsafe.incident.id)).rejects.toThrow("422")

    const recommend = await createValidatedFixture(executor, { mode: "recommend" })
    await expect(recommend.client.startIncidentRemediation(recommend.incident.id)).rejects.toThrow("409")

    const unavailable = await createValidatedFixture(undefined)
    await expect(unavailable.client.startIncidentRemediation(unavailable.incident.id)).rejects.toThrow("503")

    const runtime = new DiagnosisRuntime()
    const handler = createCoreHandler({ runtime, remediationExecutor: executor })
    const client = createPodoClient({ baseUrl: "http://podo.test", fetch: (input, init) => handler(new Request(input, init)) })
    const ingested = await client.ingestTelemetry(telemetry())
    if (!ingested.incident) throw new Error("expected incident")
    await client.updateSettings({ autonomyMode: "act_with_approval" })
    await expect(client.startIncidentRemediation(ingested.incident.id)).rejects.toThrow("409")
    await expect(client.startIncidentRemediation("unknown")).rejects.toThrow("404")
  })

  test("rejects malformed executor artifacts without exposing raw output", async () => {
    const { client, incident } = await createValidatedFixture({
      async execute() {
        return {
          ...verifiedExecutorResult(),
          patch: {
            ...verifiedExecutorResult().patch,
            changedFiles: ["../outside.ts"],
          },
          rawOutput: "secret-codex-output",
        }
      },
    })
    const pending = await client.startIncidentRemediation(incident.id)
    const failed = await client.approveIncidentRemediation(incident.id, pending.remediation.approval.id)

    expect(failed.remediation).toMatchObject({ status: "failed", error: { code: "invalid_executor_result" } })
    expect(failed.remediation.artifact).toBeUndefined()
    expect(JSON.stringify(failed)).not.toContain("secret-codex-output")
    expect(JSON.stringify(failed)).not.toContain("unifiedDiff")
  })

  test("binds artifact identity to the trusted base and rejects malformed tree provenance", async () => {
    const first = await createValidatedFixture({ async execute() { return verifiedExecutorResult() } })
    const firstPending = await first.client.startIncidentRemediation(first.incident.id)
    const firstCompleted = await first.client.approveIncidentRemediation(first.incident.id, firstPending.remediation.approval.id)

    const secondResult = {
      ...verifiedExecutorResult(),
      provenance: {
        ...verifiedExecutorResult().provenance,
        baseCommit: "c".repeat(40),
        resultTreeOid: "d".repeat(40),
      },
    }
    const second = await createValidatedFixture({ async execute() { return secondResult } })
    const secondPending = await second.client.startIncidentRemediation(second.incident.id)
    const secondCompleted = await second.client.approveIncidentRemediation(second.incident.id, secondPending.remediation.approval.id)

    expect(secondCompleted.remediation.artifact?.patch).toEqual(firstCompleted.remediation.artifact?.patch)
    expect(secondCompleted.remediation.artifact?.pullRequestPreview.id)
      .not.toBe(firstCompleted.remediation.artifact?.pullRequestPreview.id)

    for (const provenance of [
      { baseRef: "main", baseCommit: "a".repeat(40), resultTreeOid: "not-a-tree" },
      { baseRef: "../main", baseCommit: "a".repeat(40), resultTreeOid: "b".repeat(40) },
      { baseCommit: "a".repeat(40), resultTreeOid: "b".repeat(40) },
      { baseRef: "main", baseCommit: "a".repeat(40) },
    ]) {
      const fixture = await createValidatedFixture({
        async execute() { return { ...verifiedExecutorResult(), provenance } },
      })
      const pending = await fixture.client.startIncidentRemediation(fixture.incident.id)
      const failed = await fixture.client.approveIncidentRemediation(fixture.incident.id, pending.remediation.approval.id)
      expect(failed.remediation).toMatchObject({ status: "failed", error: { code: "invalid_executor_result" } })
      expect(failed.remediation.artifact).toBeUndefined()
    }
  })

  test("fails terminally for missing results, failed validation, and executor exceptions", async () => {
    const executors = [
      { execute: async () => ({}) },
      {
        execute: async () => ({
          ...verifiedExecutorResult(),
          validation: { status: "failed", checks: ["workspace-check"] },
        }),
      },
      { execute: async () => { throw new Error("raw executor secret") } },
    ]

    for (const executor of executors) {
      const { client, incident } = await createValidatedFixture(executor)
      const pending = await client.startIncidentRemediation(incident.id)
      const failed = await client.approveIncidentRemediation(incident.id, pending.remediation.approval.id)
      expect(failed.remediation.status).toBe("failed")
      expect(failed.remediation.artifact).toBeUndefined()
      expect(JSON.stringify(failed)).not.toContain("unifiedDiff")
      expect(JSON.stringify(failed)).not.toContain("raw executor secret")
    }
  })

  test("re-checks active policy before approval-triggered execution", async () => {
    const calls: unknown[] = []
    const { client, incident } = await createValidatedFixture({
      async execute(input) { calls.push(input); return verifiedExecutorResult() },
    })
    const pending = await client.startIncidentRemediation(incident.id)
    await client.updateSettings({ autonomyMode: "recommend" })
    const failed = await client.approveIncidentRemediation(incident.id, pending.remediation.approval.id)

    expect(failed.remediation).toMatchObject({ status: "failed", error: { code: "policy_denied" } })
    expect(failed.remediation.artifact).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  test("uses non-mutating preview policy after verification when mode changes to recommend", async () => {
    let release!: (value: unknown) => void
    let markStarted!: () => void
    const gate = new Promise<unknown>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const { client, incident } = await createValidatedFixture({
      async execute() { markStarted(); return gate },
    })
    const pending = await client.startIncidentRemediation(incident.id)
    const approval = client.approveIncidentRemediation(incident.id, pending.remediation.approval.id)
    await started
    expect((await client.getIncidentRemediation(incident.id)).remediation.status).toBe("running")
    await client.updateSettings({ autonomyMode: "recommend" })
    release(verifiedExecutorResult())

    const completed = await approval
    expect(completed.remediation).toMatchObject({
      status: "completed",
      artifact: { pullRequestPreview: { id: expect.stringMatching(/^pr_preview_/) } },
    })
    expect(completed.remediation.error).toBeUndefined()
  })
})
