import { expect, test } from "bun:test"
import type { CodexRuntime, CodexRuntimeEvent } from "@podo/codex-app-server-client"
import { createPodoClient } from "../../../packages/client/src/index"
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
  const client = createPodoClient({
    baseUrl: "http://podo.test",
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

test("typed client reads and updates the core-owned settings contract", async () => {
  const handler = createCoreHandler()
  const client = createPodoClient({
    baseUrl: "http://podo.test",
    fetch: (input, init) => handler(new Request(input, init)),
  })

  expect((await client.getSettings()).settings).toEqual({
    autonomyMode: "observe",
    monitoringEnabled: true,
    defaultSandbox: "read-only",
    turnTimeoutMs: 60_000,
  })

  const updated = await client.updateSettings({
    autonomyMode: "recommend",
    defaultSandbox: "workspace-write",
  })
  expect(updated.settings).toEqual({
    autonomyMode: "recommend",
    monitoringEnabled: true,
    defaultSandbox: "workspace-write",
    turnTimeoutMs: 60_000,
  })
  expect(await client.getSettings()).toEqual(updated)
})

test("typed client ingests telemetry and reads core-owned incidents", async () => {
  const handler = createCoreHandler()
  const client = createPodoClient({
    baseUrl: "http://podo.test",
    fetch: (input, init) => handler(new Request(input, init)),
  })
  const base = Date.parse("2026-07-14T09:00:00.000Z")
  const metric = (step: number, value: number) => ({
    timestamp: new Date(base + step * 1_000).toISOString(),
    kind: "metric" as const,
    service: "checkout-service",
    severity: "warn" as const,
    message: "process heap sample",
    deploymentId: "deploy-1042",
    metric: { name: "process.heap.used", value, unit: "By" },
  })
  const failure = (step: number, kind: "log" | "trace", traceId: string, message: string) => ({
    timestamp: new Date(base + step * 1_000).toISOString(),
    kind,
    service: "checkout-service",
    severity: "error" as const,
    message,
    deploymentId: "deploy-1042",
    traceId,
  })
  const result = await client.ingestTelemetry([
    metric(0, 180 * 1024 * 1024),
    metric(1, 310 * 1024 * 1024),
    metric(2, 450 * 1024 * 1024),
    metric(3, 620 * 1024 * 1024),
    failure(4, "trace", "trace-1", "POST /checkout returned 500"),
    failure(5, "log", "trace-2", "JavaScript heap out of memory"),
  ])

  expect(result.reaction.action).toBe("open_incident")
  expect(result.incident?.evidence).toHaveLength(6)
  if (!result.incident) throw new Error("expected incident")
  const incidents = await client.listIncidents()
  expect(incidents.incidents).toEqual([result.incident])
  expect(await client.getIncident(result.incident!.id)).toEqual({ incident: result.incident })
})
