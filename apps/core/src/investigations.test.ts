import { describe, expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent, StartCodexThreadInput } from "@podo/codex-app-server-client"
import type { InvestigationEvent } from "@podo/contracts"
import { createCoreHandler } from "./app"
import { InvestigationService } from "./investigations"

class FakeRuntime implements CodexRuntime {
  listeners = new Set<(event: CodexRuntimeEvent) => void>()
  decisions: Array<{ requestId: string | number; decision: string }> = []
  starts = 0
  turns = 0
  resumes = 0
  async startThread(_input: StartCodexThreadInput) { this.starts += 1; return { threadId: `internal-thread-${this.starts}` } }
  async resumeThread() { this.resumes += 1; return { threadId: "internal-thread-resumed" } }
  async startTurn() { this.turns += 1; return { turnId: `internal-turn-${this.turns}` } }
  async steerTurn() { return { turnId: "internal-turn" } }
  async interruptTurn() {}
  async resolveApproval(requestId: string | number, decision: "approve" | "deny") { this.decisions.push({ requestId, decision }) }
  onEvent(listener: (event: CodexRuntimeEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  emit(event: CodexRuntimeEvent) { for (const listener of this.listeners) listener(event) }
  async close() {}
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

  test("degrades readiness after crash and lazily creates one fresh runtime for future work", async () => {
    const crashed = new FakeRuntime()
    const fresh = new FakeRuntime()
    let factoryCalls = 0
    const handler = createCoreHandler({
      inspectCodex: async () => ({ binary: "codex", version: "0.144.1", rawVersion: "codex-cli 0.144.1" }),
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
