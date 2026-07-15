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
  const start = Date.parse("2026-07-15T09:00:00.000Z")
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

function failedExecutorResult() {
  return {
    provenance: {
      baseRef: "refs/remotes/origin/main",
      baseCommit: "a".repeat(40),
      resultTreeOid: "b".repeat(40),
    },
    patch: {
      summary: "Attempt to bound checkout cache retention",
      changedFiles: ["demo/services/checkout-service/src/cache.ts"],
      unifiedDiff: "diff --git a/demo/services/checkout-service/src/cache.ts b/demo/services/checkout-service/src/cache.ts\n-old\n+attempted",
    },
    regression: {
      test: "checkout cache remains bounded",
      prePatch: "failed" as const,
      postPatch: "passed" as const,
    },
    validation: { status: "failed" as const, checks: ["workspace-check"] },
    pullRequestPreview: {
      title: "fix(checkout): bound cache retention",
      body: "unverified private preview",
      baseBranch: "main",
      headBranch: "podo/fix-checkout-cache",
    },
  }
}

async function failedRemediationFixture(port: { deliver(input: unknown): Promise<unknown> }) {
  const runtime = new DiagnosisRuntime()
  const handler = createCoreHandler({
    runtime,
    remediationExecutor: { async execute() { return failedExecutorResult() } },
    issueDelivery: { expectedRepository: "reseaxch/podo", port },
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
  const pending = await client.startIncidentRemediation(ingested.incident.id)
  const failed = await client.approveIncidentRemediation(ingested.incident.id, pending.remediation.approval.id)
  expect(failed.remediation).toMatchObject({ status: "failed", error: { code: "verification_failed" } })
  return { client, handler, incident: investigation.incident, remediation: failed.remediation }
}

describe("incident issue fallback API", () => {
  test("requires explicit approval and creates one sanitized repository-bound issue", async () => {
    const inputs: unknown[] = []
    let draftId = ""
    const fixture = await failedRemediationFixture({
      async deliver(input) {
        inputs.push(input)
        return {
          provider: "github",
          repository: "reseaxch/podo",
          number: 9,
          url: "https://github.com/reseaxch/podo/issues/9",
          draftId,
        }
      },
    })

    const injected = await fixture.handler(new Request(
      `http://podo.test/api/incidents/${encodeURIComponent(fixture.incident.id)}/remediation/issue-delivery`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorization: { approvalId: "caller" }, repository: "attacker/podo" }),
      },
    ))
    expect(injected.status).toBe(400)
    expect(inputs).toHaveLength(0)

    const pending = await fixture.client.startIncidentIssueDelivery(fixture.incident.id)
    draftId = pending.issueDelivery.draft.id
    expect(pending.issueDelivery).toMatchObject({
      incidentId: fixture.incident.id,
      remediationId: fixture.remediation.id,
      status: "pending_approval",
      approval: { status: "pending" },
      draft: {
        id: expect.stringMatching(/^issue_draft_[a-f0-9]{24}$/),
        remediationFailureCode: "verification_failed",
        evidenceIds: fixture.incident.evidence.map(({ id }) => id).sort(),
      },
    })
    expect(pending.issueDelivery.draft.body).toContain("Heap growth correlates with checkout failures")
    expect(pending.issueDelivery.draft.body).toContain("verification_failed")
    expect(JSON.stringify(pending)).not.toContain("unifiedDiff")
    expect(JSON.stringify(pending)).not.toContain("unverified private preview")
    expect(inputs).toHaveLength(0)

    const [first, repeated] = await Promise.all([
      fixture.client.approveIncidentIssueDelivery(fixture.incident.id, pending.issueDelivery.approval.id),
      fixture.client.approveIncidentIssueDelivery(fixture.incident.id, pending.issueDelivery.approval.id),
    ])

    expect(repeated).toEqual(first)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      issueDeliveryId: pending.issueDelivery.id,
      incidentId: fixture.incident.id,
      remediationId: fixture.remediation.id,
      authorization: {
        kind: "core.issue_delivery.v1",
        approvalId: pending.issueDelivery.approval.id,
        approvedAt: expect.stringMatching(/^20\d\d-/),
      },
      draft: { id: draftId, remediationFailureCode: "verification_failed" },
    })
    expect(JSON.stringify(inputs[0])).not.toContain("unifiedDiff")
    expect(first.issueDelivery).toMatchObject({
      status: "delivered",
      issue: {
        provider: "github",
        repository: "reseaxch/podo",
        number: 9,
        url: "https://github.com/reseaxch/podo/issues/9",
        draftId,
      },
    })
    expect((await fixture.client.getIncidentRemediationAudit(fixture.incident.id)).events.slice(-4)).toMatchObject([
      { kind: "issue_delivery.requested", draftId },
      { kind: "issue_delivery.approval_decided", decision: "approve" },
      { kind: "issue_delivery.started", draftId },
      { kind: "issue_delivery.succeeded", draftId, issueUrl: "https://github.com/reseaxch/podo/issues/9" },
    ])
  })

  test("keeps denial mutation-free and records only the request and decision", async () => {
    let deliveries = 0
    const fixture = await failedRemediationFixture({
      async deliver() { deliveries += 1; throw new Error("must not run") },
    })
    const pending = await fixture.client.startIncidentIssueDelivery(fixture.incident.id)
    const denied = await fixture.client.denyIncidentIssueDelivery(
      fixture.incident.id,
      pending.issueDelivery.approval.id,
    )

    expect(denied.issueDelivery).toMatchObject({ status: "denied", approval: { status: "denied" } })
    expect(deliveries).toBe(0)
    expect((await fixture.client.getIncidentRemediationAudit(fixture.incident.id)).events.slice(-2)).toMatchObject([
      { kind: "issue_delivery.requested" },
      { kind: "issue_delivery.approval_decided", decision: "deny" },
    ])
  })

  test("fails closed without exposing an issue when the provider fails or changes repository identity", async () => {
    for (const scenario of [
      { expectedCode: "delivery_failed", port: { async deliver() { throw new Error("private provider failure") } } },
      { expectedCode: "invalid_delivery_result", port: {
        async deliver(input: unknown) {
          const draftId = (input as { draft: { id: string } }).draft.id
          return {
            provider: "github",
            repository: "attacker/podo",
            number: 10,
            url: "https://github.com/attacker/podo/issues/10",
            draftId,
          }
        },
      } },
    ] as const) {
      const fixture = await failedRemediationFixture(scenario.port)
      const pending = await fixture.client.startIncidentIssueDelivery(fixture.incident.id)
      const failed = await fixture.client.approveIncidentIssueDelivery(
        fixture.incident.id,
        pending.issueDelivery.approval.id,
      )
      expect(failed.issueDelivery.status).toBe("failed")
      expect(failed.issueDelivery.issue).toBeUndefined()
      expect(failed.issueDelivery.error?.message).not.toContain("private provider failure")
      expect(failed.issueDelivery.error?.code).toBe(scenario.expectedCode)
      expect((await fixture.client.getIncidentRemediationAudit(fixture.incident.id)).events.at(-1)).toMatchObject({
        kind: "issue_delivery.failed",
      })
    }
  })
})
