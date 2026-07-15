import { describe, expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent } from "@podo/codex-app-server-client"

import { createPodoClient } from "../../../../../packages/client/src/index"
import { createCoreHandler } from "../../app"

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

function completeDiagnosis(runtime: DiagnosisRuntime, evidenceIds: string[], safeToAttemptFix = true): void {
  const output = JSON.stringify({
    schemaVersion: "podo.diagnosis.v1",
    summary: "Heap growth correlates with checkout failures",
    affectedService: "checkout-service",
    probableRootCause: "The deployed cache retains entries without a bound",
    confidence: { value: 9000, scale: "basis_points" },
    evidenceIds,
    recommendedAction: "Bound the cache and add a regression test",
    safeToAttemptFix,
  })
  runtime.emit({ kind: "output.delta", threadId: "private-thread", turnId: "private-turn", text: output })
  runtime.emit({ kind: "turn.completed", threadId: "private-thread", turnId: "private-turn", status: "completed" })
}

function verifiedExecutorResult() {
  return {
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

describe("incident remediation API", () => {
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

  test("does not publish a verified artifact if policy changes during execution", async () => {
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

    const failed = await approval
    expect(failed.remediation).toMatchObject({ status: "failed", error: { code: "policy_denied" } })
    expect(failed.remediation.artifact).toBeUndefined()
  })
})
