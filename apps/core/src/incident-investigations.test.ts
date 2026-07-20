import { describe, expect, test } from "bun:test"
import {
  AppServerRuntime,
  type CodexRuntime,
  type CodexRuntimeEvent,
  type StartCodexThreadInput,
} from "@podo/codex-app-server-client"
import { createPodoClient } from "../../../packages/client/src/index"
import { createCoreHandler } from "./app"
import { IncidentMonitor } from "./modules/incidents/incident-monitor"

class RecordingRuntime implements CodexRuntime {
  readonly listeners = new Set<(event: CodexRuntimeEvent) => void>()
  readonly threadInputs: StartCodexThreadInput[] = []
  readonly prompts: string[] = []
  readonly decisions: Array<{ requestId: string | number; decision: "approve" | "deny" }> = []

  async startThread(input: StartCodexThreadInput) {
    this.threadInputs.push(input)
    return { threadId: `private-thread-${this.threadInputs.length}` }
  }
  async resumeThread() { return { threadId: "private-thread-resumed" } }
  async startTurn(_threadId: string, prompt: string) {
    this.prompts.push(prompt)
    return { turnId: `private-turn-${this.prompts.length}` }
  }
  async steerTurn() { return { turnId: "private-turn" } }
  async interruptTurn() {}
  async resolveApproval(requestId: string | number, decision: "approve" | "deny") {
    this.decisions.push({ requestId, decision })
  }
  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(event: CodexRuntimeEvent) { for (const listener of this.listeners) listener(event) }
  async close() {}
}

class SynchronousApprovalRuntime extends RecordingRuntime {
  override async startTurn(threadId: string, prompt: string) {
    this.prompts.push(prompt)
    this.emit({
      kind: "approval.requested",
      requestId: 91,
      approvalKind: "command",
      threadId,
      turnId: "private-turn-1",
      itemId: "private-item-1",
      command: "cat /private/runtime/secret",
    })
    return { turnId: "private-turn-1" }
  }
}

type RuntimeTransport = ConstructorParameters<typeof AppServerRuntime>[0]
type ServerNotification = Parameters<Parameters<RuntimeTransport["onNotification"]>[0]>[0]
type ServerRequest = Parameters<Parameters<RuntimeTransport["onServerRequest"]>[0]>[0]

class NotificationTransport {
  private notificationListener?: (notification: ServerNotification) => void

  async request(method: string): Promise<unknown> {
    if (method === "thread/start") return { thread: { id: "private-thread-1" } }
    if (method === "turn/start") return { turn: { id: "private-turn-1" } }
    return {}
  }
  async respond() {}
  async rejectServerRequest() {}
  onNotification(listener: (notification: ServerNotification) => void) {
    this.notificationListener = listener
    return () => {}
  }
  onServerRequest(_listener: (request: ServerRequest) => void) { return () => {} }
  onClose(_listener: (error: Error) => void) { return () => {} }
  async close() {}
  notify(notification: ServerNotification) { this.notificationListener?.(notification) }
}

function incidentTelemetry() {
  const base = Date.parse("2026-07-14T09:00:00.000Z")
  const metric = (step: number, value: number) => ({
    timestamp: new Date(base + step * 1_000).toISOString(),
    kind: "metric" as const,
    service: "checkout-service",
    severity: "warn" as const,
    message: "process heap sample",
    deploymentId: "deploy-1042",
    commitId: "abc123",
    metric: { name: "process.heap.used", value, unit: "By" },
  })
  const failure = (step: number, kind: "log" | "trace", traceId: string, message: string) => ({
    timestamp: new Date(base + step * 1_000).toISOString(),
    kind,
    service: "checkout-service",
    severity: "error" as const,
    message,
    deploymentId: "deploy-1042",
    commitId: "abc123",
    traceId,
  })
  return [
    metric(0, 180 * 1024 * 1024),
    metric(1, 310 * 1024 * 1024),
    metric(2, 450 * 1024 * 1024),
    metric(3, 620 * 1024 * 1024),
    failure(4, "trace", "trace-1", "POST /checkout returned 500"),
    failure(5, "log", "trace-2", "JavaScript heap out of memory"),
  ]
}

async function openIncident(client: ReturnType<typeof createPodoClient>): Promise<string> {
  const result = await client.ingestTelemetry(incidentTelemetry())
  if (!result.incident) throw new Error("expected incident")
  return result.incident.id
}

interface TestClientResult<T extends CodexRuntime> {
  client: ReturnType<typeof createPodoClient>
  handler: ReturnType<typeof createCoreHandler>
  runtime: T
}

function testClient(): TestClientResult<RecordingRuntime>
function testClient<T extends CodexRuntime>(
  runtime: T,
  incidentMonitor?: IncidentMonitor,
): TestClientResult<T>
function testClient(
  runtime: CodexRuntime = new RecordingRuntime(),
  incidentMonitor?: IncidentMonitor,
): TestClientResult<CodexRuntime> {
  const handler = createCoreHandler({ runtime, ...(incidentMonitor ? { incidentMonitor } : {}) })
  const client = createPodoClient({
    baseUrl: "http://podo.test",
    fetch: (input, init) => handler(new Request(input, init)),
  })
  return { client, handler, runtime }
}

function validDiagnosis(evidenceIds: string[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: "podo.diagnosis.v1",
    summary: "Heap growth correlates with checkout failures",
    affectedService: "checkout-service",
    probableRootCause: "The deployed cache retains entries without a bound",
    confidence: { value: 8750, scale: "basis_points" },
    evidenceIds,
    recommendedAction: "Inspect the cache retention policy",
    safeToAttemptFix: false,
    ...overrides,
  })
}

function complete(runtime: RecordingRuntime, output: string): void {
  const midpoint = Math.floor(output.length / 2)
  runtime.emit({
    kind: "output.delta",
    threadId: "private-thread-1",
    turnId: "private-turn-1",
    text: output.slice(0, midpoint),
  })
  runtime.emit({
    kind: "output.delta",
    threadId: "private-thread-1",
    turnId: "private-turn-1",
    text: output.slice(midpoint),
  })
  runtime.emit({
    kind: "turn.completed",
    threadId: "private-thread-1",
    turnId: "private-turn-1",
    status: "completed",
  })
}

describe("incident-scoped investigation", () => {
  test("audits ordered App Server tool lifecycle without exposing provider input or output", async () => {
    const transport = new NotificationTransport()
    const runtime = new AppServerRuntime(transport)
    const { client } = testClient(runtime)
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    const command = "curl -H 'Authorization: Bearer private-command-token' https://private.example"
    const commandOutput = "response private-output-token"
    const mcpArguments = { apiKey: "private-mcp-token", query: "secret customer" }
    const mcpResult = { content: ["private-mcp-output"], structuredContent: null, _meta: null }

    transport.notify({
      method: "item/started",
      params: {
        threadId: "private-thread-1",
        turnId: "private-turn-1",
        startedAtMs: 1,
        item: {
          type: "commandExecution",
          id: "private-command-item",
          command,
          cwd: "/private/repository",
          processId: null,
          source: "agent",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      },
    } as ServerNotification)
    transport.notify({
      method: "item/started",
      params: {
        threadId: "private-thread-1",
        turnId: "private-turn-1",
        startedAtMs: 2,
        item: {
          type: "mcpToolCall",
          id: "private-mcp-item",
          server: "private-server",
          tool: "private-tool",
          status: "inProgress",
          arguments: mcpArguments,
          appContext: null,
          pluginId: null,
          result: null,
          error: null,
          durationMs: null,
        },
      },
    } as ServerNotification)
    transport.notify({
      method: "item/completed",
      params: {
        threadId: "private-thread-1",
        turnId: "private-turn-1",
        completedAtMs: 3,
        item: {
          type: "commandExecution",
          id: "private-command-item",
          command,
          cwd: "/private/repository",
          processId: null,
          source: "agent",
          status: "failed",
          commandActions: [],
          aggregatedOutput: commandOutput,
          exitCode: 22,
          durationMs: 5,
        },
      },
    } as ServerNotification)
    transport.notify({
      method: "item/completed",
      params: {
        threadId: "private-thread-1",
        turnId: "private-turn-1",
        completedAtMs: 4,
        item: {
          type: "mcpToolCall",
          id: "private-mcp-item",
          server: "private-server",
          tool: "private-tool",
          status: "completed",
          arguments: mcpArguments,
          appContext: null,
          pluginId: null,
          result: mcpResult,
          error: null,
          durationMs: 7,
        },
      },
    } as ServerNotification)

    const audit = await client.getIncidentAudit(incidentId)
    const toolSteps = audit.events.filter((event) => event.kind === "investigation.tool_step")
    expect(toolSteps).toEqual([
      {
        sequence: 3,
        occurredAt: expect.any(String),
        incidentId,
        kind: "investigation.tool_step",
        investigationId: started.investigation.id,
        stepId: expect.any(String),
        tool: "command",
        status: "started",
        inputSummary: `Command content withheld (${command.length} characters).`,
      },
      {
        sequence: 4,
        occurredAt: expect.any(String),
        incidentId,
        kind: "investigation.tool_step",
        investigationId: started.investigation.id,
        stepId: expect.any(String),
        tool: "mcp",
        status: "started",
        inputSummary: "MCP arguments withheld.",
      },
      {
        sequence: 5,
        occurredAt: expect.any(String),
        incidentId,
        kind: "investigation.tool_step",
        investigationId: started.investigation.id,
        stepId: expect.any(String),
        tool: "command",
        status: "failed",
        inputSummary: `Command content withheld (${command.length} characters).`,
        outputSummary: `Process output withheld (${commandOutput.length} characters); exit code 22.`,
      },
      {
        sequence: 6,
        occurredAt: expect.any(String),
        incidentId,
        kind: "investigation.tool_step",
        investigationId: started.investigation.id,
        stepId: expect.any(String),
        tool: "mcp",
        status: "completed",
        inputSummary: "MCP arguments withheld.",
        outputSummary: "MCP result content withheld.",
      },
    ])
    expect(toolSteps[0]?.stepId).toBe(toolSteps[2]?.stepId)
    expect(toolSteps[1]?.stepId).toBe(toolSteps[3]?.stepId)
    expect(JSON.stringify(audit)).not.toContain("private-command-token")
    expect(JSON.stringify(audit)).not.toContain("private-output-token")
    expect(JSON.stringify(audit)).not.toContain("private-mcp-token")
    expect(JSON.stringify(audit)).not.toContain("private-mcp-output")
    expect(JSON.stringify(audit)).not.toContain("private-command-item")
    expect(JSON.stringify(audit)).not.toContain("private-thread-1")
  })

  test("starts one read-only investigation from core-owned prompt and evidence", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })

    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })

    expect(started.incident.id).toBe(incidentId)
    expect(started.incident.investigation).toMatchObject({
      id: started.investigation.id,
      status: "running",
    })
    expect(runtime.threadInputs).toHaveLength(1)
    expect(runtime.threadInputs[0]).toMatchObject({ cwd: "/repo", sandbox: "read-only" })
    expect(runtime.prompts).toHaveLength(1)
    expect(runtime.threadInputs[0]?.developerInstructions).toContain("You are the Podo incident investigator.")
    expect(runtime.threadInputs[0]?.developerInstructions).toContain("Allowed read tools:")
    expect(runtime.threadInputs[0]?.developerInstructions).toContain("Forbidden tools:")
    expect(runtime.threadInputs[0]?.developerInstructions).toContain("podo.diagnosis.v1")
    expect(runtime.threadInputs[0]?.developerInstructions).toContain("exactly one JSON object")
    expect(runtime.prompts[0]).not.toContain("You are the Podo incident investigator.")
    expect(runtime.prompts[0]).not.toContain("Allowed read tools:")
    expect(runtime.prompts[0]).not.toContain("Forbidden tools:")
    expect(runtime.prompts[0]).toContain(`Incident id: ${incidentId}`)
    expect(runtime.prompts[0]).toContain("deploy-1042")
    expect(runtime.prompts[0]).toContain("process heap sample")
    expect(runtime.prompts[0]).toContain("untrusted_evidence_json")
    for (const evidence of started.incident.evidence) expect(runtime.prompts[0]).toContain(evidence.id)
    expect(JSON.stringify(started)).not.toContain("private-thread")

    const current = await client.getIncident(incidentId)
    expect(current.incident.investigation).toEqual(started.incident.investigation)
    expect(current.incident.diagnosis).toBeUndefined()
  })

  test("projects a validated diagnosis only after the linked investigation completes", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })

    expect((await client.getIncident(incidentId)).incident.diagnosis).toBeUndefined()
    complete(runtime, validDiagnosis(started.incident.evidence.map((item) => item.id)))

    const current = await client.getIncident(incidentId)
    expect(current.incident.investigation?.status).toBe("completed")
    expect(current.incident.diagnosis).toEqual({
      status: "validated",
      schemaVersion: "podo.diagnosis.v1",
      summary: "Heap growth correlates with checkout failures",
      affectedService: "checkout-service",
      probableRootCause: "The deployed cache retains entries without a bound",
      confidence: { value: 8750, scale: "basis_points" },
      evidenceIds: started.incident.evidence.map((item) => item.id),
      recommendedAction: "Inspect the cache retention policy",
      safeToAttemptFix: false,
    })
    expect(JSON.stringify(current)).not.toContain("private-thread")
  })

  test("fails malformed and unknown-evidence output closed without leaking raw output or fix safety", async () => {
    for (const output of [
      '{"safeToAttemptFix":true',
      validDiagnosis(["ev-model-invented"], { safeToAttemptFix: true }),
    ]) {
      const { client, runtime } = testClient()
      const incidentId = await openIncident(client)
      await client.updateSettings({ autonomyMode: "recommend" })
      await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
      complete(runtime, output)

      const current = await client.getIncident(incidentId)
      expect(current.incident.investigation?.status).toBe("completed")
      expect(current.incident.diagnosis).toEqual({
        status: "failed",
        error: {
          code: "invalid_output",
          message: "Codex output did not satisfy the Podo diagnosis contract",
        },
      })
      expect(JSON.stringify(current.incident.diagnosis)).not.toContain("safeToAttemptFix")
      expect(JSON.stringify(current.incident.diagnosis)).not.toContain("ev-model-invented")
    }
  })

  test("fails a valid diagnosis for a different service closed", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    complete(runtime, validDiagnosis(started.incident.evidence.map((item) => item.id), {
      affectedService: "inventory-service",
      safeToAttemptFix: true,
    }))

    expect((await client.getIncident(incidentId)).incident.diagnosis).toEqual({
      status: "failed",
      error: {
        code: "affected_service_mismatch",
        message: "Diagnosis affectedService does not match the incident",
      },
    })
  })

  test("models an investigation failure without exposing its raw runtime error as diagnosis", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    runtime.emit({
      kind: "runtime.error",
      threadId: "private-thread-1",
      turnId: "private-turn-1",
      message: "sensitive raw runtime failure",
    })

    const diagnosis = (await client.getIncident(incidentId)).incident.diagnosis
    expect(diagnosis).toEqual({
      status: "failed",
      error: {
        code: "investigation_failed",
        message: "Investigation failed before producing a validated diagnosis",
      },
    })
    expect(JSON.stringify(diagnosis)).not.toContain("sensitive raw runtime failure")
  })

  test("reconciles completed output on an idempotent start without relying on a subscription", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const first = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    complete(runtime, validDiagnosis(first.incident.evidence.map((item) => item.id)))

    const second = await client.startIncidentInvestigation(incidentId, { cwd: "/different-repo" })

    expect(second.investigation.id).toBe(first.investigation.id)
    expect(second.incident.diagnosis?.status).toBe("validated")
    expect(runtime.threadInputs).toHaveLength(1)
  })

  test("fails closed in observe mode without touching Codex", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)

    await expect(client.startIncidentInvestigation(incidentId, { cwd: "/repo" })).rejects.toThrow(
      '"error":"policy_denied"',
    )
    expect(runtime.threadInputs).toEqual([])
    expect((await client.getIncident(incidentId)).incident.investigation).toBeUndefined()
  })

  test("returns not found for an unknown incident without touching Codex", async () => {
    const { client, runtime } = testClient()
    await client.updateSettings({ autonomyMode: "recommend" })

    await expect(client.startIncidentInvestigation("incident-missing", { cwd: "/repo" })).rejects.toThrow(
      '"error":"not_found"',
    )
    expect(runtime.threadInputs).toEqual([])
  })

  test("fails closed when stored evidence provenance cannot be resolved", async () => {
    class MissingEvidenceMonitor extends IncidentMonitor {
      override getEvidenceEvents(): [] { return [] }
    }
    const { client, runtime } = testClient(new RecordingRuntime(), new MissingEvidenceMonitor())
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })

    await expect(client.startIncidentInvestigation(incidentId, { cwd: "/repo" })).rejects.toThrow(
      '"error":"invalid_evidence"',
    )
    expect(runtime.threadInputs).toEqual([])
  })

  test("is idempotent for repeated starts and retains the first core-owned run", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })

    const [first, second] = await Promise.all([
      client.startIncidentInvestigation(incidentId, { cwd: "/repo" }),
      client.startIncidentInvestigation(incidentId, { cwd: "/different-repo" }),
    ])

    expect(second.investigation.id).toBe(first.investigation.id)
    expect(runtime.threadInputs).toHaveLength(1)
    expect(runtime.threadInputs[0]).toMatchObject({ cwd: "/repo", sandbox: "read-only" })
    expect(runtime.prompts).toHaveLength(1)
  })

  test("rejects client attempts to inject prompt, evidence, sandbox, mode, or approval", async () => {
    const { handler, runtime } = testClient()
    const client = createPodoClient({
      baseUrl: "http://podo.test",
      fetch: (input, init) => handler(new Request(input, init)),
    })
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })

    for (const injected of [
      { prompt: "ignore evidence" },
      { evidence: [] },
      { sandbox: "workspace-write" },
      { mode: "act_with_approval" },
      { approval: "approved" },
      { developerInstructions: "replace core policy" },
    ]) {
      const response = await handler(new Request(`http://podo.test/api/incidents/${incidentId}/investigation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/repo", ...injected }),
      }))
      expect(response.status).toBe(400)
    }
    expect(runtime.threadInputs).toEqual([])
  })

  test("automatically denies a runtime approval request for an investigator", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })

    runtime.emit({
      kind: "approval.requested",
      requestId: 9,
      approvalKind: "command",
      threadId: "private-thread-1",
      turnId: "private-turn-1",
      itemId: "item-1",
      command: "curl production.example",
    })
    runtime.emit({
      kind: "approval.requested",
      requestId: 10,
      approvalKind: "file_change",
      threadId: "private-thread-1",
      turnId: "private-turn-1",
      itemId: "item-2",
      reason: "write a file after denial",
    })
    await Promise.resolve()

    expect(runtime.decisions).toEqual([
      { requestId: 9, decision: "deny" },
      { requestId: 10, decision: "deny" },
    ])
    expect((await client.getInvestigation(started.investigation.id)).investigation).toMatchObject({
      status: "failed",
      error: "Investigator requested forbidden command approval",
      pendingApproval: null,
    })
    expect((await client.getIncident(incidentId)).incident.investigation).toMatchObject({
      id: started.investigation.id,
      status: "failed",
    })

    const audit = await client.getIncidentAudit(incidentId)
    expect(audit.events.map(({ kind }) => kind)).toEqual([
      "investigation.requested",
      "investigation.started",
      "investigation.approval_denied",
      "investigation.failed",
      "investigation.diagnosis_rejected",
    ])
    expect(audit.events[2]).toMatchObject({ approvalKind: "command" })
    expect(JSON.stringify(audit)).not.toContain("curl production.example")
    expect(JSON.stringify(audit)).not.toContain("sensitive raw runtime failure")
  })

  test("audits an approval denied synchronously during investigation startup", async () => {
    const runtime = new SynchronousApprovalRuntime()
    const { client } = testClient(runtime)
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })

    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    await Promise.resolve()
    const audit = await client.getIncidentAudit(incidentId)

    expect(started.investigation.status).toBe("failed")
    expect(runtime.decisions).toEqual([{ requestId: 91, decision: "deny" }])
    expect(audit.events.map(({ kind }) => kind)).toEqual([
      "investigation.requested",
      "investigation.started",
      "investigation.approval_denied",
      "investigation.failed",
      "investigation.diagnosis_rejected",
    ])
    expect(audit.events[2]).toMatchObject({
      investigationId: started.investigation.id,
      approvalKind: "command",
    })
    expect(JSON.stringify(audit)).not.toContain("cat /private/runtime/secret")
  })

  test("audits validated investigation outcome once before any incident read", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    const evidenceIds = started.incident.evidence.map(({ id }) => id)
    complete(runtime, validDiagnosis(evidenceIds))

    const firstAudit = await client.getIncidentAudit(incidentId)
    const repeatedAudit = await client.getIncidentAudit(incidentId)

    expect(firstAudit.events.map(({ kind }) => kind)).toEqual([
      "investigation.requested",
      "investigation.started",
      "investigation.completed",
      "investigation.diagnosis_validated",
    ])
    expect(firstAudit.events[3]).toMatchObject({ evidenceIds })
    expect(repeatedAudit).toEqual(firstAudit)
  })

  test("audits rejected diagnosis outcome once before any incident read", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incidentId, { cwd: "/repo" })
    complete(runtime, validDiagnosis(["ev-model-invented"]))

    const firstAudit = await client.getIncidentAudit(incidentId)
    const repeatedAudit = await client.getIncidentAudit(incidentId)

    expect(firstAudit.events.map(({ kind }) => kind)).toEqual([
      "investigation.requested",
      "investigation.started",
      "investigation.completed",
      "investigation.diagnosis_rejected",
    ])
    expect(firstAudit.events[3]).toMatchObject({
      investigationId: started.investigation.id,
      code: "invalid_output",
    })
    expect(repeatedAudit).toEqual(firstAudit)
  })

  test("bounds repeated policy-denied audit attempts per incident", async () => {
    const { client, runtime } = testClient()
    const incidentId = await openIncident(client)

    for (let attempt = 0; attempt < 300; attempt++) {
      await expect(client.startIncidentInvestigation(incidentId, { cwd: "/repo" })).rejects.toThrow(
        '"error":"policy_denied"',
      )
    }

    const audit = await client.getIncidentAudit(incidentId)
    expect(runtime.threadInputs).toEqual([])
    expect(audit.events).toHaveLength(256)
    expect(audit.events[0]).toMatchObject({ sequence: 45, kind: "investigation.requested" })
    expect(audit.events.at(-1)).toMatchObject({ sequence: 300, kind: "investigation.requested" })
  })
})
