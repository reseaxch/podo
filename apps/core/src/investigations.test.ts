import { describe, expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent, StartCodexThreadInput } from "@podo/codex-app-server-client"
import type { InvestigationEvent } from "@podo/contracts"
import { createCoreHandler } from "./app"
import { InvestigationService } from "./investigations"

class FakeRuntime implements CodexRuntime {
  listeners = new Set<(event: CodexRuntimeEvent) => void>()
  decisions: Array<{ requestId: string | number; decision: string }> = []
  interrupts: Array<{ threadId: string; turnId: string }> = []
  starts = 0
  turns = 0
  resumes = 0
  completeBeforeStartTurnReturns = false
  completionTurnIdBeforeStartTurnReturns?: string
  outputEventsBeforeStartTurnReturns = 0
  approvalResolution?: Promise<void>
  async startThread(_input: StartCodexThreadInput) { this.starts += 1; return { threadId: `internal-thread-${this.starts}` } }
  async resumeThread() { this.resumes += 1; return { threadId: "internal-thread-resumed" } }
  async startTurn() {
    this.turns += 1
    const turnId = `internal-turn-${this.turns}`
    if (this.completeBeforeStartTurnReturns) {
      this.emit({
        kind: "turn.completed",
        threadId: `internal-thread-${this.starts}`,
        turnId: this.completionTurnIdBeforeStartTurnReturns ?? turnId,
        status: "completed",
      })
    }
    for (let index = 0; index < this.outputEventsBeforeStartTurnReturns; index += 1) {
      this.emit({ kind: "output.delta", threadId: `internal-thread-${this.starts}`, turnId, text: String(index) })
    }
    return { turnId }
  }
  async steerTurn() { return { turnId: "internal-turn" } }
  async interruptTurn(threadId: string, turnId: string) { this.interrupts.push({ threadId, turnId }) }
  async resolveApproval(requestId: string | number, decision: "approve" | "deny") {
    this.decisions.push({ requestId, decision })
    await this.approvalResolution
  }
  onEvent(listener: (event: CodexRuntimeEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  emit(event: CodexRuntimeEvent) { for (const listener of this.listeners) listener(event) }
  async close() {}
}

class ManualInvestigationTimer {
  private nextId = 1
  private readonly callbacks = new Map<number, () => void>()
  readonly delays: number[] = []
  readonly cleared: number[] = []

  schedule(callback: () => void, delayMs: number): number {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    this.delays.push(delayMs)
    return id
  }

  clear(handle: unknown): void {
    if (typeof handle !== "number") return
    this.cleared.push(handle)
    this.callbacks.delete(handle)
  }

  fire(handle = this.nextId - 1): void {
    const callback = this.callbacks.get(handle)
    if (!callback) throw new Error("investigation timer was not scheduled")
    callback()
  }
}

async function start(handler: ReturnType<typeof createCoreHandler>) {
  const response = await handler(new Request("http://podo.test/api/investigations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "investigate", cwd: "/repo", sandbox: "workspace-write" }),
  }))
  expect(response.status).toBe(201)
  return (await response.json() as { investigation: { id: string } }).investigation.id
}

async function startService(service: InvestigationService) {
  const response = await service.start({ prompt: "investigate", cwd: "/repo", sandbox: "read-only" })
  return response.investigation.id
}

describe("investigation orchestration", () => {
  test("captures complete ordered output independently of the bounded public event log", async () => {
    const runtime = new FakeRuntime()
    const service = new InvestigationService({ runtime, eventLogLimit: 2 })
    const id = await startService(service)

    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "root " })
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "root " })
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "cause" })

    expect(service.getCompletedOutput(id)).toBeNull()
    expect(service.replay(id, 0)?.map(({ kind }) => kind)).toEqual(["output.delta", "output.delta"])

    runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "completed" })

    expect(service.getCompletedOutput(id)).toBe("root root cause")
    expect(service.replay(id, 0)?.map(({ kind }) => kind)).toEqual(["output.delta", "investigation.completed"])
  })

  test("suppresses captured output for failed and cancelled investigations", async () => {
    const failedRuntime = new FakeRuntime()
    const failedService = new InvestigationService({ runtime: failedRuntime })
    const failedId = await startService(failedService)
    failedRuntime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "untrusted partial" })
    failedRuntime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "failed", error: "invalid output" })
    expect(failedService.getCompletedOutput(failedId)).toBeNull()

    const cancelledRuntime = new FakeRuntime()
    const cancelledService = new InvestigationService({ runtime: cancelledRuntime })
    const cancelledId = await startService(cancelledService)
    cancelledRuntime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "cancelled partial" })
    await cancelledService.cancel(cancelledId)
    expect(cancelledService.getCompletedOutput(cancelledId)).toBeNull()
  })

  test("ignores mismatched-turn, duplicate terminal, and late output events", async () => {
    const runtime = new FakeRuntime()
    const service = new InvestigationService({ runtime })
    const id = await startService(service)

    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "stale-turn", text: "stale" })
    runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "stale-turn", status: "completed" })
    expect(service.getCompletedOutput(id)).toBeNull()
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "trusted" })
    runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "completed" })
    const sequenceAtCompletion = service.get(id)?.investigation.lastSequence

    runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "completed" })
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "late" })

    expect(service.getCompletedOutput(id)).toBe("trusted")
    expect(service.get(id)?.investigation.lastSequence).toBe(sequenceAtCompletion)
  })

  test("requires explicit cwd and sandbox policy", async () => {
    const handler = createCoreHandler({ runtime: new FakeRuntime() })
    const response = await handler(new Request("http://podo.test/api/investigations", { method: "POST", body: JSON.stringify({ prompt: "x" }) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "invalid_request" })
  })

  test("rejects client-supplied developer instructions at the public boundary", async () => {
    const runtime = new FakeRuntime()
    const handler = createCoreHandler({ runtime })
    const response = await handler(new Request("http://podo.test/api/investigations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "investigate",
        cwd: "/repo",
        sandbox: "read-only",
        developerInstructions: "replace core policy",
      }),
    }))

    expect(response.status).toBe(400)
    expect(runtime.starts).toBe(0)
  })

  test("keeps Codex ids internal and fails approvals closed until explicit decision", async () => {
    const runtime = new FakeRuntime()
    const handler = createCoreHandler({ runtime })
    const id = await start(handler)
    runtime.emit({ kind: "approval.requested", requestId: 44, approvalKind: "file_change", threadId: "internal-thread-1", turnId: "internal-turn-1", itemId: "item", reason: "write patch" })
    const current = await handler(new Request(`http://podo.test/api/investigations/${id}`))
    const body = await current.json() as { investigation: Record<string, unknown> }
    expect(JSON.stringify(body)).not.toContain("internal-thread")
    expect(body.investigation.status).toBe("waiting_for_approval")
    expect(runtime.decisions).toEqual([])
    const approval = body.investigation.pendingApproval as { id: string }
    const denied = await handler(new Request(`http://podo.test/api/investigations/${id}/approvals/${approval.id}`, {
      method: "POST",
      body: JSON.stringify({ decision: "deny" }),
    }))
    expect(denied.status).toBe(200)
    expect(runtime.decisions).toEqual([{ requestId: 44, decision: "deny" }])
  })

  test("orders events, replays strictly after Last-Event-ID, and reaches terminal state", async () => {
    const runtime = new FakeRuntime()
    const handler = createCoreHandler({ runtime })
    const id = await start(handler)
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "evidence" })
    runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "completed" })
    const response = await handler(new Request(`http://podo.test/api/investigations/${id}/events`, { headers: { "last-event-id": "1" } }))
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ""
    while (!text.includes("investigation.completed")) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value)
    }
    await reader.cancel()
    const events = text.split("\n\n").filter(Boolean).map((frame) => JSON.parse(frame.split("\ndata: ")[1]!) as InvestigationEvent)
    expect(events.map((event) => event.sequence)).toEqual([2, 3, 4])
    expect(events.map((event) => event.kind)).toEqual(["investigation.running", "output.delta", "investigation.completed"])
  })

  test("turns a runtime crash into an explicit failed terminal state", async () => {
    const runtime = new FakeRuntime()
    const handler = createCoreHandler({ runtime })
    const id = await start(handler)
    runtime.emit({ kind: "runtime.error", message: "app-server EOF" })
    const response = await handler(new Request(`http://podo.test/api/investigations/${id}`))
    expect(await response.json()).toMatchObject({ investigation: { status: "failed", error: "app-server EOF" } })
  })

  test("fails and best-effort interrupts a never-completing turn at the configured deadline", async () => {
    const runtime = new FakeRuntime()
    const timer = new ManualInvestigationTimer()
    const service = new InvestigationService({ runtime, timer })
    const started = await service.start(
      { prompt: "investigate", cwd: "/repo", sandbox: "read-only" },
      { turnTimeoutMs: 60_000 },
    )
    const id = started.investigation.id

    expect(service.get(id)?.investigation.status).toBe("running")
    expect(timer.delays).toEqual([60_000])

    timer.fire()
    await Promise.resolve()

    expect(service.get(id)?.investigation).toMatchObject({
      status: "failed",
      error: "Investigation exceeded the configured turn timeout",
    })
    expect(service.replay(id, 0)?.at(-1)?.kind).toBe("investigation.failed")
    expect(runtime.interrupts).toEqual([{
      threadId: "internal-thread-1",
      turnId: "internal-turn-1",
    }])
    expect(timer.cleared).toEqual([1])

    const terminalSequence = service.get(id)?.investigation.lastSequence
    runtime.emit({
      kind: "turn.completed",
      threadId: "internal-thread-1",
      turnId: "internal-turn-1",
      status: "completed",
    })
    expect(service.get(id)?.investigation.lastSequence).toBe(terminalSequence)
    expect(service.getCompletedOutput(id)).toBeNull()
  })

  test("does not arm a timeout after a terminal event races the startTurn response", async () => {
    const runtime = new FakeRuntime()
    runtime.completeBeforeStartTurnReturns = true
    const timer = new ManualInvestigationTimer()
    const service = new InvestigationService({ runtime, timer })

    const started = await service.start(
      { prompt: "fast investigation", cwd: "/repo", sandbox: "read-only" },
      { turnTimeoutMs: 60_000 },
    )

    expect(started.investigation.status).toBe("completed")
    expect(service.getCompletedOutput(started.investigation.id)).toBe("")
    expect(timer.delays).toEqual([])
    expect(timer.cleared).toEqual([])
  })

  test("does not correlate a buffered terminal event from a different turn", async () => {
    const runtime = new FakeRuntime()
    runtime.completeBeforeStartTurnReturns = true
    runtime.completionTurnIdBeforeStartTurnReturns = "foreign-turn"
    const timer = new ManualInvestigationTimer()
    const service = new InvestigationService({ runtime, timer })

    const started = await service.start(
      { prompt: "investigate current turn", cwd: "/repo", sandbox: "read-only" },
      { turnTimeoutMs: 60_000 },
    )

    expect(started.investigation.status).toBe("running")
    expect(service.getCompletedOutput(started.investigation.id)).toBeNull()
    expect(timer.delays).toEqual([60_000])
  })

  test("interrupts a timed-out turn even when denying its pending approval never settles", async () => {
    const runtime = new FakeRuntime()
    runtime.approvalResolution = new Promise(() => {})
    const timer = new ManualInvestigationTimer()
    const service = new InvestigationService({ runtime, timer })
    const started = await service.start(
      { prompt: "investigate", cwd: "/repo", sandbox: "read-only" },
      { turnTimeoutMs: 60_000 },
    )
    runtime.emit({
      kind: "approval.requested",
      requestId: "pending-approval",
      approvalKind: "user_input",
      threadId: "internal-thread-1",
      turnId: "internal-turn-1",
      itemId: "question",
      questions: [],
    })

    timer.fire()
    await Promise.resolve()

    expect(service.get(started.investigation.id)?.investigation.status).toBe("failed")
    expect(runtime.decisions).toEqual([{ requestId: "pending-approval", decision: "deny" }])
    expect(runtime.interrupts).toEqual([{ threadId: "internal-thread-1", turnId: "internal-turn-1" }])
  })

  test("fails closed when turn events overflow the bounded startTurn race buffer", async () => {
    const runtime = new FakeRuntime()
    runtime.outputEventsBeforeStartTurnReturns = 3
    const timer = new ManualInvestigationTimer()
    const service = new InvestigationService({ runtime, timer, eventLogLimit: 2 })

    const started = await service.start(
      { prompt: "fast noisy investigation", cwd: "/repo", sandbox: "read-only" },
      { turnTimeoutMs: 60_000 },
    )

    expect(started.investigation).toMatchObject({
      status: "failed",
      error: "Investigation turn event buffer exceeded configured limit",
    })
    expect(service.replay(started.investigation.id, 0)?.filter(({ kind }) => kind === "investigation.failed")).toHaveLength(1)
    expect(runtime.interrupts).toEqual([{ threadId: "internal-thread-1", turnId: "internal-turn-1" }])
    expect(timer.delays).toEqual([])
  })

  test("bounds tracked tool steps and interrupts a noisy turn on overflow", async () => {
    const runtime = new FakeRuntime()
    const service = new InvestigationService({ runtime, eventLogLimit: 2 })
    const observed: InvestigationEvent[] = []
    const started = await service.start(
      { prompt: "tool-heavy investigation", cwd: "/repo", sandbox: "read-only" },
      { onEvent: (event) => observed.push(event) },
    )

    for (let index = 0; index < 300; index += 1) {
      runtime.emit({
        kind: "tool.started",
        threadId: "internal-thread-1",
        turnId: "internal-turn-1",
        itemId: `item-${index}`,
        tool: "command",
        inputSummary: "Command content withheld (42 characters).",
      })
    }
    await Promise.resolve()

    expect(service.get(started.investigation.id)?.investigation).toMatchObject({
      status: "failed",
      error: "Investigation tool step tracking exceeded configured limit",
    })
    expect(observed.filter(({ kind }) => kind === "tool.step")).toHaveLength(2)
    expect(runtime.interrupts).toEqual([{ threadId: "internal-thread-1", turnId: "internal-turn-1" }])
  })

  test("rejects an unbounded runtime item id before tracking it", async () => {
    const runtime = new FakeRuntime()
    const service = new InvestigationService({ runtime, eventLogLimit: 2 })
    const observed: InvestigationEvent[] = []
    const started = await service.start(
      { prompt: "unsafe item id", cwd: "/repo", sandbox: "read-only" },
      { onEvent: (event) => observed.push(event) },
    )

    runtime.emit({
      kind: "tool.started",
      threadId: "internal-thread-1",
      turnId: "internal-turn-1",
      itemId: "x".repeat(257),
      tool: "command",
      inputSummary: "Command content withheld (42 characters).",
    })
    await Promise.resolve()

    expect(service.get(started.investigation.id)?.investigation).toMatchObject({
      status: "failed",
      error: "Investigation tool step identifier was invalid",
    })
    expect(observed.filter(({ kind }) => kind === "tool.step")).toEqual([])
    expect(runtime.interrupts).toEqual([{ threadId: "internal-thread-1", turnId: "internal-turn-1" }])
  })

  test("clears the supervised deadline on every non-timeout terminal path", async () => {
    const terminalCases: Array<{
      name: string
      finish(runtime: FakeRuntime, service: InvestigationService, id: string): void | Promise<unknown>
    }> = [
      {
        name: "completed",
        finish(runtime) {
          runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "completed" })
        },
      },
      {
        name: "interrupted",
        finish(runtime) {
          runtime.emit({ kind: "turn.completed", threadId: "internal-thread-1", turnId: "internal-turn-1", status: "interrupted" })
        },
      },
      {
        name: "failed",
        finish(runtime) {
          runtime.emit({ kind: "runtime.error", threadId: "internal-thread-1", turnId: "internal-turn-1", message: "runtime failed" })
        },
      },
      {
        name: "cancelled",
        finish(_runtime, service, id) {
          return service.cancel(id)
        },
      },
    ]

    for (const terminalCase of terminalCases) {
      const runtime = new FakeRuntime()
      const timer = new ManualInvestigationTimer()
      const service = new InvestigationService({ runtime, timer })
      const started = await service.start(
        { prompt: `investigate ${terminalCase.name}`, cwd: "/repo", sandbox: "read-only" },
        { turnTimeoutMs: 60_000 },
      )

      await terminalCase.finish(runtime, service, started.investigation.id)

      expect(service.isTerminal(started.investigation.id)).toBe(true)
      expect(timer.cleared).toEqual([1])
    }
  })

  test("degrades readiness after crash and lazily creates one fresh runtime for future work", async () => {
    const crashed = new FakeRuntime()
    const fresh = new FakeRuntime()
    let factoryCalls = 0
    const handler = createCoreHandler({
      inspectCodex: async () => ({ binary: "codex", version: "0.144.5", rawVersion: "codex-cli 0.144.5" }),
      runtime: crashed,
      createRuntime: async () => { factoryCalls += 1; return fresh },
    })
    const firstId = await start(handler)
    crashed.emit({ kind: "runtime.error", message: "app-server EOF" })
    const degraded = await handler(new Request("http://podo.test/readyz"))
    expect(degraded.status).toBe(503)
    expect(await degraded.json()).toMatchObject({ status: "degraded", codex: { available: false, error: "app-server EOF" } })
    const secondId = await start(handler)
    expect(factoryCalls).toBe(1)
    expect({ crashedStarts: crashed.starts, crashedTurns: crashed.turns, crashedResumes: crashed.resumes }).toEqual({ crashedStarts: 1, crashedTurns: 1, crashedResumes: 0 })
    expect({ freshStarts: fresh.starts, freshTurns: fresh.turns, freshResumes: fresh.resumes }).toEqual({ freshStarts: 1, freshTurns: 1, freshResumes: 0 })
    expect((await (await handler(new Request(`http://podo.test/api/investigations/${firstId}`))).json() as { investigation: { status: string } }).investigation.status).toBe("failed")
    expect((await (await handler(new Request(`http://podo.test/api/investigations/${secondId}`))).json() as { investigation: { status: string } }).investigation.status).toBe("running")
    const ready = await handler(new Request("http://podo.test/readyz"))
    expect(ready.status).toBe(200)
    expect(await ready.json()).toMatchObject({ status: "ready", codex: { available: true } })
  })

  test("rejects malformed approval answers before touching runtime", async () => {
    const runtime = new FakeRuntime()
    const handler = createCoreHandler({ runtime })
    const id = await start(handler)
    runtime.emit({ kind: "approval.requested", requestId: 45, approvalKind: "user_input", threadId: "internal-thread-1", turnId: "internal-turn-1", itemId: "item", questions: [] })
    const current = await handler(new Request(`http://podo.test/api/investigations/${id}`))
    const approvalId = ((await current.json() as { investigation: { pendingApproval: { id: string } } }).investigation.pendingApproval.id)
    for (const answers of [null, [], { question: "not-an-array" }, { question: ["ok", 1] }]) {
      const response = await handler(new Request(`http://podo.test/api/investigations/${id}/approvals/${approvalId}`, {
        method: "POST",
        body: JSON.stringify({ decision: "approve", answers }),
      }))
      expect(response.status).toBe(400)
    }
    expect(runtime.decisions).toEqual([])
  })

  test("rejects replay cursors older than the bounded event log", async () => {
    const runtime = new FakeRuntime()
    const handler = createCoreHandler({ runtime, eventLogLimit: 2 })
    const id = await start(handler)
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "one" })
    runtime.emit({ kind: "output.delta", threadId: "internal-thread-1", turnId: "internal-turn-1", text: "two" })
    const response = await handler(new Request(`http://podo.test/api/investigations/${id}/events`, { headers: { "last-event-id": "0" } }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "event_replay_expired" })
  })
})
