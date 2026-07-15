import { describe, expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent } from "@podo/codex-app-server-client"

import { createPodoClient } from "../../../../../packages/client/src/index"
import { createCoreHandler } from "../../app"

const baseCommit = "a".repeat(40)

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
  const start = Date.parse("2026-07-14T09:00:00.000Z")
  return [
    ...[180, 310, 450, 620].map((mib, step) => ({
      timestamp: new Date(start + step * 1_000).toISOString(),
      kind: "metric" as const,
      service: "checkout-service",
      severity: "warn" as const,
      message: "process heap sample",
      deploymentId: "deploy-1042",
      metric: { name: "process.heap.used", value: mib * 1024 * 1024, unit: "By" },
    })),
    {
      timestamp: new Date(start + 4_000).toISOString(),
      kind: "trace" as const,
      service: "checkout-service",
      severity: "error" as const,
      message: "POST /checkout returned 500",
      deploymentId: "deploy-1042",
      traceId: "trace-1",
    },
    {
      timestamp: new Date(start + 5_000).toISOString(),
      kind: "log" as const,
      service: "checkout-service",
      severity: "error" as const,
      message: "JavaScript heap out of memory",
      deploymentId: "deploy-1042",
      traceId: "trace-2",
    },
  ]
}

function completeDiagnosis(runtime: DiagnosisRuntime, evidenceIds: string[]): void {
  runtime.emit({
    kind: "output.delta",
    threadId: "private-thread",
    turnId: "private-turn",
    text: JSON.stringify({
      schemaVersion: "podo.diagnosis.v1",
      summary: "Heap growth correlates with checkout failures",
      affectedService: "checkout-service",
      probableRootCause: "The deployed cache retains entries without a bound",
      confidence: { value: 9000, scale: "basis_points" },
      evidenceIds,
      recommendedAction: "Bound the cache and add a regression test",
      safeToAttemptFix: true,
    }),
  })
  runtime.emit({ kind: "turn.completed", threadId: "private-thread", turnId: "private-turn", status: "completed" })
}

function verifiedExecutorResult() {
  return {
    provenance: { baseCommit },
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

async function completedRemediationFixture(delivery: { deliver(input: unknown): Promise<unknown> }) {
  const runtime = new DiagnosisRuntime()
  const remediationExecutor = { async execute() { return verifiedExecutorResult() } }
  const handler = createCoreHandler({
    runtime,
    remediationExecutor,
    pullRequestDelivery: { expectedRepository: "reseaxch/podo", port: delivery },
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
  const remediation = await client.startIncidentRemediation(ingested.incident.id)
  const completed = await client.approveIncidentRemediation(ingested.incident.id, remediation.remediation.approval.id)
  if (!completed.remediation.artifact) throw new Error("expected verified artifact")
  return { client, handler, incident: ingested.incident, remediation: completed.remediation }
}

function deliveredResult(artifactId: string) {
  return {
    provider: "github",
    repository: "reseaxch/podo",
    number: 6,
    url: "https://github.com/reseaxch/podo/pull/6",
    baseCommit,
    baseBranch: "main",
    headBranch: "podo/fix-checkout-cache",
    artifactId,
  }
}

describe("incident pull request delivery API", () => {
  test("requires a second approval and delivers the immutable verified artifact at most once", async () => {
    const deliveryInputs: unknown[] = []
    let artifactId = ""
    const fixture = await completedRemediationFixture({
      async deliver(input) {
        deliveryInputs.push(input)
        return deliveredResult(artifactId)
      },
    })
    artifactId = fixture.remediation.artifact!.pullRequestPreview.id

    const injectedStart = await fixture.handler(new Request(
      `http://podo.test/api/incidents/${encodeURIComponent(fixture.incident.id)}/remediation/delivery`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: "caller", authorization: { approvalId: "caller" } }),
      },
    ))
    expect(injectedStart.status).toBe(400)

    const pending = await fixture.client.startIncidentDelivery(fixture.incident.id)
    expect(pending.delivery).toMatchObject({
      incidentId: fixture.incident.id,
      remediationId: fixture.remediation.id,
      artifactId,
      status: "pending_approval",
      approval: { status: "pending" },
    })
    expect(deliveryInputs).toHaveLength(0)

    const injectedApproval = await fixture.handler(new Request(
      `http://podo.test/api/incidents/${encodeURIComponent(fixture.incident.id)}/remediation/delivery/approvals/${encodeURIComponent(pending.delivery.approval.id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", authorization: { approvalId: "caller" } }),
      },
    ))
    expect(injectedApproval.status).toBe(400)
    expect(deliveryInputs).toHaveLength(0)

    const [first, repeated] = await Promise.all([
      fixture.client.approveIncidentDelivery(fixture.incident.id, pending.delivery.approval.id),
      fixture.client.approveIncidentDelivery(fixture.incident.id, pending.delivery.approval.id),
    ])

    expect(repeated).toEqual(first)
    expect(deliveryInputs).toHaveLength(1)
    expect(deliveryInputs[0]).toMatchObject({
      incidentId: fixture.incident.id,
      remediationId: fixture.remediation.id,
      deliveryId: pending.delivery.id,
      authorization: {
        kind: "core.pull_request_delivery.v1",
        approvalId: pending.delivery.approval.id,
        approvedAt: expect.stringMatching(/^2026-|^20\d\d-/),
      },
      artifact: {
        provenance: { baseCommit },
        pullRequestPreview: { id: artifactId, baseBranch: "main", headBranch: "podo/fix-checkout-cache" },
      },
    })
    expect(first.delivery).toMatchObject({
      status: "delivered",
      approval: { status: "approved" },
      pullRequest: {
        provider: "github",
        repository: "reseaxch/podo",
        number: 6,
        url: "https://github.com/reseaxch/podo/pull/6",
        artifactId,
        baseCommit,
        baseBranch: "main",
      },
    })
    expect((await fixture.client.getIncidentRemediationAudit(fixture.incident.id)).events.slice(-4)).toMatchObject([
      { kind: "delivery.requested" },
      { kind: "delivery.approval_decided", decision: "approve" },
      { kind: "delivery.started" },
      { kind: "delivery.succeeded", artifactId, pullRequestUrl: "https://github.com/reseaxch/podo/pull/6" },
    ])
  })

  test("keeps denial mutation-free and fails delivery without exposing untrusted provider output", async () => {
    const deniedCalls: unknown[] = []
    const deniedFixture = await completedRemediationFixture({
      async deliver(input) { deniedCalls.push(input); return {} },
    })
    const deniedPending = await deniedFixture.client.startIncidentDelivery(deniedFixture.incident.id)
    const denied = await deniedFixture.client.denyIncidentDelivery(
      deniedFixture.incident.id,
      deniedPending.delivery.approval.id,
    )
    expect(denied.delivery).toMatchObject({ status: "denied", approval: { status: "denied" } })
    expect(deniedCalls).toHaveLength(0)

    const failedFixture = await completedRemediationFixture({
      async deliver() { throw new Error("private-provider-output") },
    })
    const failedPending = await failedFixture.client.startIncidentDelivery(failedFixture.incident.id)
    const failed = await failedFixture.client.approveIncidentDelivery(
      failedFixture.incident.id,
      failedPending.delivery.approval.id,
    )
    expect(failed.delivery).toMatchObject({ status: "failed", error: { code: "delivery_failed" } })
    expect(failed.delivery.pullRequest).toBeUndefined()
    expect(JSON.stringify(failed)).not.toContain("private-provider-output")
    expect(JSON.stringify(failed)).not.toContain("unifiedDiff")

    let invalidArtifactId = ""
    const invalidFixture = await completedRemediationFixture({
      async deliver() {
        return {
          ...deliveredResult(invalidArtifactId),
          repository: "attacker/podo",
          url: "https://github.com/attacker/podo/pull/6",
        }
      },
    })
    invalidArtifactId = invalidFixture.remediation.artifact!.pullRequestPreview.id
    const invalidPending = await invalidFixture.client.startIncidentDelivery(invalidFixture.incident.id)
    const invalid = await invalidFixture.client.approveIncidentDelivery(
      invalidFixture.incident.id,
      invalidPending.delivery.approval.id,
    )
    expect(invalid.delivery).toMatchObject({ status: "failed", error: { code: "invalid_delivery_result" } })
    expect(invalid.delivery.pullRequest).toBeUndefined()
    expect(JSON.stringify(invalid)).not.toContain("attacker/podo")

    let wrongBaseArtifactId = ""
    const wrongBaseFixture = await completedRemediationFixture({
      async deliver() {
        return { ...deliveredResult(wrongBaseArtifactId), baseBranch: "release" }
      },
    })
    wrongBaseArtifactId = wrongBaseFixture.remediation.artifact!.pullRequestPreview.id
    const wrongBasePending = await wrongBaseFixture.client.startIncidentDelivery(wrongBaseFixture.incident.id)
    const wrongBase = await wrongBaseFixture.client.approveIncidentDelivery(
      wrongBaseFixture.incident.id,
      wrongBasePending.delivery.approval.id,
    )
    expect(wrongBase.delivery).toMatchObject({ status: "failed", error: { code: "invalid_delivery_result" } })
    expect(wrongBase.delivery.pullRequest).toBeUndefined()
    expect(JSON.stringify(wrongBase)).not.toContain("release")
  })

  test("keeps create_pull_request authorization exclusively behind delivery approval policy", async () => {
    const calls: unknown[] = []
    const fixture = await completedRemediationFixture({
      async deliver(input) { calls.push(input); return {} },
    })

    expect(fixture.remediation).toMatchObject({
      status: "completed",
      artifact: { pullRequestPreview: { id: expect.stringMatching(/^pr_preview_/) } },
    })
    expect(calls).toHaveLength(0)

    await fixture.client.updateSettings({ autonomyMode: "recommend" })
    await expect(fixture.client.startIncidentDelivery(fixture.incident.id)).rejects.toThrow("409")
    expect(calls).toHaveLength(0)
  })
})
