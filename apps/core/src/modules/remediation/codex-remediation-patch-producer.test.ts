import { describe, expect, test } from "bun:test"
import type {
  CodexRuntime,
  CodexRuntimeEvent,
  StartCodexThreadInput,
} from "@podo/codex-app-server-client"
import type { RequestOptions } from "@podo/codex-app-server-client"

import type { IncidentRemediationExecutorInput } from "./incident-remediation"
import {
  CodexRemediationPatchProducer,
  CodexRemediationPatchProducerError,
} from "./codex-remediation-patch-producer"

class FakeRuntime implements CodexRuntime {
  readonly listeners = new Set<(event: CodexRuntimeEvent) => void>()
  readonly starts: StartCodexThreadInput[] = []
  readonly resumes: Array<{ threadId: string; input: StartCodexThreadInput }> = []
  readonly turns: Array<{ threadId: string; prompt: string }> = []
  readonly approvals: Array<{ requestId: string | number; decision: "approve" | "deny" }> = []
  readonly interrupts: Array<{ threadId: string; turnId: string }> = []
  readonly phaseEvents: CodexRuntimeEvent[][] = []

  async startThread(input: StartCodexThreadInput, _options?: RequestOptions) {
    this.starts.push(input)
    return { threadId: "private-thread" }
  }

  async resumeThread(threadId: string, input: StartCodexThreadInput, _options?: RequestOptions) {
    this.resumes.push({ threadId, input })
    return { threadId }
  }

  async startTurn(threadId: string, prompt: string, _options?: RequestOptions) {
    const turnId = `private-turn-${this.turns.length + 1}`
    this.turns.push({ threadId, prompt })
    const events = this.phaseEvents.shift() ?? []
    queueMicrotask(() => {
      for (const event of events) this.emit(event)
    })
    return { turnId }
  }

  async steerTurn() { return { turnId: "unused" } }

  async interruptTurn(threadId: string, turnId: string) {
    this.interrupts.push({ threadId, turnId })
  }

  async resolveApproval(requestId: string | number, decision: "approve" | "deny") {
    this.approvals.push({ requestId, decision })
  }

  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close() {}

  emit(event: CodexRuntimeEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

describe("CodexRemediationPatchProducer", () => {
  test("writes a regression and applies the fix in two completed turns on one bounded thread", async () => {
    const runtime = new FakeRuntime()
    runtime.phaseEvents.push([
      approval("other-request", "command", "other-thread", "other-turn", "curl https://example.com"),
      completed("private-thread", "private-turn-1"),
    ], [
      completed("private-thread", "private-turn-2"),
    ])
    const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 1_000 })

    await producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() })
    await producer.applyFix({ worktreePath: process.cwd(), remediation: remediation() })

    expect(runtime.starts).toHaveLength(1)
    expect(runtime.starts[0]).toMatchObject({ cwd: process.cwd(), sandbox: "workspace-write" })
    expect(runtime.starts[0]?.developerInstructions).toContain("Network access is forbidden")
    const startedThread = runtime.starts[0]!
    expect(runtime.resumes).toEqual([{
      threadId: "private-thread",
      input: startedThread,
    }])
    expect(runtime.turns.map((turn) => turn.threadId)).toEqual(["private-thread", "private-thread"])
    expect(runtime.turns[0]?.prompt).toContain("PHASE 1 OF 2: WRITE THE REGRESSION")
    expect(runtime.turns[0]?.prompt).toContain('"incidentId":"incident-1"')
    expect(runtime.turns[1]?.prompt).toContain("PHASE 2 OF 2: APPLY THE FIX")
    expect(runtime.turns[1]?.prompt).toContain("Do not modify the regression test")
    expect(runtime.approvals).toEqual([])
    expect(runtime.interrupts).toEqual([])
    expect(runtime.listeners.size).toBe(0)
  })

  for (const approvalKind of ["permissions", "user_input"] as const) {
    test(`denies ${approvalKind} requests and fails closed`, async () => {
      const runtime = new FakeRuntime()
      runtime.phaseEvents.push([
        approval(10, approvalKind, "private-thread", "private-turn-1"),
      ])
      const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 1_000 })

      const result = producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() })

      await expect(result).rejects.toThrow("codex_remediation_forbidden_approval")
      expect(runtime.approvals).toEqual([{ requestId: 10, decision: "deny" }])
      expect(runtime.interrupts).toEqual([{ threadId: "private-thread", turnId: "private-turn-1" }])
      expect(runtime.listeners.size).toBe(0)
    })
  }

  for (const approvalKind of ["command", "file_change"] as const) {
    test(`denies an unprovable ${approvalKind} boundary exception`, async () => {
      const runtime = new FakeRuntime()
      runtime.phaseEvents.push([
        approval(11, approvalKind, "private-thread", "private-turn-1", "bun test test/cache.test.ts"),
      ])
      const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 1_000 })

      const result = producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() })

      await expect(result).rejects.toThrow("codex_remediation_unprovable_approval")
      await expect(result).rejects.not.toThrow("bun test")
      expect(runtime.approvals).toEqual([{ requestId: 11, decision: "deny" }])
      expect(runtime.interrupts).toEqual([{ threadId: "private-thread", turnId: "private-turn-1" }])
    })
  }

  test("interrupts a turn that exceeds the configured deadline", async () => {
    const runtime = new FakeRuntime()
    const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 10 })

    await expect(producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() }))
      .rejects.toThrow("codex_remediation_turn_timeout")

    expect(runtime.interrupts).toEqual([{ threadId: "private-thread", turnId: "private-turn-1" }])
    expect(runtime.listeners.size).toBe(0)
  })

  test("ignores unrelated events but rejects a matching unknown approval kind", async () => {
    const unrelatedRuntime = new FakeRuntime()
    unrelatedRuntime.phaseEvents.push([
      { kind: "runtime.error", threadId: "other-thread", turnId: "other-turn", message: "not ours" },
      completed("other-thread", "private-turn-1"),
      completed("private-thread", "other-turn"),
      completed("private-thread", "private-turn-1"),
    ])
    const producer = new CodexRemediationPatchProducer({ runtime: unrelatedRuntime, turnTimeoutMs: 1_000 })
    await expect(producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() })).resolves.toBeUndefined()

    const unknownRuntime = new FakeRuntime()
    unknownRuntime.phaseEvents.push([
      approval(12, "unknown" as "command", "private-thread", "private-turn-1"),
    ])
    const unknownProducer = new CodexRemediationPatchProducer({ runtime: unknownRuntime, turnTimeoutMs: 1_000 })
    await expect(unknownProducer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() }))
      .rejects.toThrow("codex_remediation_forbidden_approval")
    expect(unknownRuntime.approvals).toEqual([{ requestId: 12, decision: "deny" }])
  })

  for (const status of ["failed", "interrupted"] as const) {
    test(`rejects a ${status} Codex turn without exposing runtime details`, async () => {
      const runtime = new FakeRuntime()
      runtime.phaseEvents.push([
        { kind: "turn.completed", threadId: "private-thread", turnId: "private-turn-1", status, error: "private upstream detail" },
      ])
      const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 1_000 })
      const result = producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() })

      await expect(result).rejects.toThrow(`codex_remediation_turn_${status}`)
      await expect(result).rejects.not.toThrow("private upstream detail")
    })
  }

  test("requires the completed regression context before continuing the same remediation", async () => {
    const runtime = new FakeRuntime()
    const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 1_000 })

    await expect(producer.applyFix({ worktreePath: process.cwd(), remediation: remediation() }))
      .rejects.toThrow("codex_remediation_regression_required")

    runtime.phaseEvents.push([completed("private-thread", "private-turn-1")])
    await producer.writeRegression({ worktreePath: process.cwd(), remediation: remediation() })
    await expect(producer.applyFix({
      worktreePath: process.cwd(),
      remediation: { ...remediation(), incident: { ...remediation().incident, id: "different-incident" } },
    })).rejects.toThrow("codex_remediation_context_mismatch")
  })

  test("disposes retained regression context idempotently before the worktree disappears", async () => {
    const runtime = new FakeRuntime()
    runtime.phaseEvents.push([completed("private-thread", "private-turn-1")])
    const producer = new CodexRemediationPatchProducer({ runtime, turnTimeoutMs: 1_000 })
    const input = { worktreePath: process.cwd(), remediation: remediation() }

    await producer.writeRegression(input)
    await producer.dispose(input)
    await producer.dispose(input)

    await expect(producer.applyFix(input)).rejects.toThrow("codex_remediation_regression_required")
    expect(runtime.resumes).toEqual([])
  })

  test("exposes stable sanitized producer errors", () => {
    const error = new CodexRemediationPatchProducerError("codex_remediation_turn_failed")
    expect(error.message).toBe("codex_remediation_turn_failed")
    expect(error.code).toBe("codex_remediation_turn_failed")
  })
})

function remediation(): IncidentRemediationExecutorInput {
  return {
    incident: {
      id: "incident-1",
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
      evidenceIds: ["metric-heap", "trace-checkout"],
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "Checkout cache growth is unbounded",
        affectedService: "checkout-service",
        probableRootCause: "The cache has no eviction bound",
        confidence: { value: 9700, scale: "basis_points" },
        evidenceIds: ["metric-heap", "trace-checkout"],
        recommendedAction: "Bound cache retention and preserve the regression",
        safeToAttemptFix: true,
      },
    },
    target: "isolated_checkout",
    policy: {
      systemPrompt: "approved bounded remediation policy",
      allowedTools: ["search_code", "apply_patch", "run_test"],
      forbiddenTools: ["create_pull_request"],
    },
  }
}

function approval(
  requestId: string | number,
  approvalKind: "command" | "file_change" | "permissions" | "user_input",
  threadId: string,
  turnId: string,
  command?: string,
): CodexRuntimeEvent {
  return {
    kind: "approval.requested",
    requestId,
    approvalKind,
    threadId,
    turnId,
    itemId: "private-item",
    ...(command ? { command } : {}),
  }
}

function completed(threadId: string, turnId: string): CodexRuntimeEvent {
  return { kind: "turn.completed", threadId, turnId, status: "completed" }
}
