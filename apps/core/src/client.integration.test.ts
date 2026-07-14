import { expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent } from "@rootline/codex-app-server-client"
import { createRootlineClient } from "../../../packages/client/src/index"
import { createCoreHandler } from "./app"

test("typed client consumes the core investigation and event contracts", async () => {
  const listeners = new Set<(event: CodexRuntimeEvent) => void>()
  const decisions: Array<{ requestId: string | number; decision: string }> = []
  const runtime: CodexRuntime = {
    async startThread() { return { threadId: "private-thread" } },
    async resumeThread() { return { threadId: "private-thread" } },
    async startTurn() { return { turnId: "private-turn" } },
    async steerTurn() { return { turnId: "private-turn" } },
    async interruptTurn() {},
    async resolveApproval(requestId, decision) { decisions.push({ requestId, decision }) },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async close() {},
  }
  const handler = createCoreHandler({ runtime })
  const client = createRootlineClient({
    baseUrl: "http://rootline.test",
    fetch: (input, init) => handler(new Request(input, init)),
  })
  const started = await client.start({ prompt: "investigate", cwd: "/repo", sandbox: "read-only" })
  for (const listener of listeners) {
    listener({
      kind: "approval.requested",
      requestId: 9,
      approvalKind: "command",
      threadId: "private-thread",
      turnId: "private-turn",
      itemId: "private-item",
      command: "bun test",
    })
  }
  const pending = await client.get(started.investigation.id)
  await client.deny(started.investigation.id, pending.investigation.pendingApproval!.id)
  await client.cancel(started.investigation.id)
  const events = []
  for await (const event of client.subscribeEvents(started.investigation.id)) events.push(event)
  expect(events.map((event) => event.kind)).toEqual([
    "investigation.started",
    "investigation.running",
    "approval.requested",
    "approval.resolved",
    "investigation.cancelled",
  ])
  expect(decisions).toEqual([{ requestId: 9, decision: "deny" }])
  expect((await client.get(started.investigation.id)).investigation.status).toBe("cancelled")
  expect(JSON.stringify(started)).not.toContain("private-thread")
})
