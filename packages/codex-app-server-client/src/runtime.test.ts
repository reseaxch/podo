import { describe, expect, test } from "bun:test"
import type { ServerNotification } from "@rootline/codex-protocol/generated/ServerNotification.ts"
import type { ServerRequest } from "@rootline/codex-protocol/generated/ServerRequest.ts"
import { AppServerRuntime, type CodexRuntimeEvent } from "./runtime"

class FakeTransport {
  notifications?: (notification: ServerNotification) => void
  serverRequests?: (request: ServerRequest) => void
  closeListener?: (error: Error) => void
  responses: Array<{ id: string | number; result?: unknown; error?: { code: number; message: string } }> = []
  requests: Array<{ method: string; params: unknown }> = []
  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "thread-1" } }
    if (method === "turn/start") return { turn: { id: "turn-1" } }
    if (method === "turn/steer") return { turnId: "turn-1" }
    return {}
  }
  async respond(id: string | number, result: unknown) { this.responses.push({ id, result }) }
  async rejectServerRequest(id: string | number, code: number, message: string) { this.responses.push({ id, error: { code, message } }) }
  onNotification(listener: (notification: ServerNotification) => void) { this.notifications = listener; return () => {} }
  onServerRequest(listener: (request: ServerRequest) => void) { this.serverRequests = listener; return () => {} }
  onClose(listener: (error: Error) => void) { this.closeListener = listener; return () => {} }
  async close() {}
}

describe("AppServerRuntime", () => {
  test("starts a policy-bound thread and maps terminal lifecycle", async () => {
    const transport = new FakeTransport()
    const runtime = new AppServerRuntime(transport)
    const events: CodexRuntimeEvent[] = []
    runtime.onEvent((event) => events.push(event))
    await expect(runtime.startThread({ cwd: "/repo", sandbox: "workspace-write" })).resolves.toEqual({ threadId: "thread-1" })
    await expect(runtime.startTurn("thread-1", "investigate")).resolves.toEqual({ turnId: "turn-1" })
    expect(transport.requests[0]).toMatchObject({ method: "thread/start", params: { cwd: "/repo", sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" } })
    transport.notifications?.({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [], itemsView: "full", error: null, startedAt: 1, completedAt: 2, durationMs: 1000 } } } as ServerNotification)
    expect(events).toEqual([{ kind: "turn.completed", threadId: "thread-1", turnId: "turn-1", status: "completed" }])
  })

  test("holds approval until an explicit decision and fails unsupported requests closed", async () => {
    const transport = new FakeTransport()
    const runtime = new AppServerRuntime(transport)
    const events: CodexRuntimeEvent[] = []
    runtime.onEvent((event) => events.push(event))
    transport.serverRequests?.({ id: 7, method: "item/fileChange/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", startedAtMs: 1 } } as ServerRequest)
    expect(transport.responses).toEqual([])
    expect(events[0]).toMatchObject({ kind: "approval.requested", approvalKind: "file_change", requestId: 7 })
    await runtime.resolveApproval(7, "deny")
    expect(transport.responses).toEqual([{ id: 7, result: { decision: "decline" } }])
    transport.serverRequests?.({ id: 8, method: "item/tool/call", params: {} } as ServerRequest)
    expect(transport.responses[1]).toEqual({ id: 8, error: { code: -32601, message: "Unsupported server request: item/tool/call" } })
  })

  test("uses exact response shapes for every supported server request", async () => {
    const transport = new FakeTransport()
    const runtime = new AppServerRuntime(transport)
    const cases: Array<{ request: ServerRequest; decision: "approve" | "deny"; answers?: Record<string, string[]>; expected: unknown }> = [
      { request: { id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "t", turnId: "v", itemId: "i", startedAtMs: 1, environmentId: null } } as ServerRequest, decision: "approve", expected: { id: 1, result: { decision: "accept" } } },
      { request: { id: 2, method: "item/fileChange/requestApproval", params: { threadId: "t", turnId: "v", itemId: "i", startedAtMs: 1 } } as ServerRequest, decision: "deny", expected: { id: 2, result: { decision: "decline" } } },
      { request: { id: 3, method: "execCommandApproval", params: { conversationId: "t", callId: "i", command: ["echo"] } } as ServerRequest, decision: "approve", expected: { id: 3, result: { decision: "approved" } } },
      { request: { id: 4, method: "applyPatchApproval", params: { conversationId: "t", callId: "i", fileChanges: {} } } as ServerRequest, decision: "deny", expected: { id: 4, result: { decision: "denied" } } },
      { request: { id: 5, method: "item/permissions/requestApproval", params: { threadId: "t", turnId: "v", itemId: "i", environmentId: null, startedAtMs: 1, cwd: "/repo", reason: null, permissions: { network: null, fileSystem: { read: ["/repo"], write: ["/repo"] } } } } as ServerRequest, decision: "approve", expected: { id: 5, result: { permissions: { fileSystem: { read: ["/repo"], write: ["/repo"] } }, scope: "turn" } } },
      { request: { id: 6, method: "item/permissions/requestApproval", params: { threadId: "t", turnId: "v", itemId: "i", environmentId: null, startedAtMs: 1, cwd: "/repo", reason: null, permissions: { network: null, fileSystem: null } } } as ServerRequest, decision: "deny", expected: { id: 6, result: { permissions: {}, scope: "turn" } } },
      { request: { id: 7, method: "item/tool/requestUserInput", params: { threadId: "t", turnId: "v", itemId: "i", questions: [], autoResolutionMs: null } } as ServerRequest, decision: "approve", answers: { choice: ["yes"] }, expected: { id: 7, result: { answers: { choice: { answers: ["yes"] } } } } },
      { request: { id: 8, method: "item/tool/requestUserInput", params: { threadId: "t", turnId: "v", itemId: "i", questions: [], autoResolutionMs: null } } as ServerRequest, decision: "deny", expected: { id: 8, error: { code: -32001, message: "User denied input request" } } },
    ]
    for (const entry of cases) {
      transport.serverRequests?.(entry.request)
      await runtime.resolveApproval(entry.request.id, entry.decision, entry.answers)
      expect(transport.responses.at(-1) as unknown).toEqual(entry.expected)
    }
  })
})
