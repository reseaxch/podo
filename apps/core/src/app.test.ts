import { describe, expect, test } from "bun:test"
import type { CodexRuntime } from "@podo/codex-app-server-client"
import { PODO_CODE_GRAPH_SCHEMA_VERSION, type NormalizedCodeGraphSnapshot } from "@podo/contracts"
import { createCoreHandler } from "./app"
import type { IncidentGraphConfig } from "./modules/graph/incident-causal-path"

describe("Podo core handler", () => {
  test("shares the supervised investigation runtime with remediation", async () => {
    let runtimeProvider: (() => Promise<CodexRuntime>) | undefined
    const handler = createCoreHandler({
      runtime: sharedRuntime,
      inspectCodex: async () => ({ binary: "codex", version: "test", rawVersion: "test" }),
      remediationExecutorFactory(provider) {
        runtimeProvider = provider
        return { async execute() { throw new Error("not used") } }
      },
    })

    expect(runtimeProvider).toBeDefined()
    expect(await runtimeProvider!()).toBe(sharedRuntime)
    const status = await handler(new Request("http://podo.test/api/system"))
    expect(await status.json()).toMatchObject({ remediation: { configured: true } })
  })

  test("rejects ambiguous remediation composition", () => {
    const executor = { async execute() { throw new Error("not used") } }
    expect(() => createCoreHandler({
      remediationExecutor: executor,
      remediationExecutorFactory: () => executor,
    })).toThrow("remediation_executor_configuration_is_ambiguous")
  })

  test("rejects an invalid operator-configured delivery repository", () => {
    expect(() => createCoreHandler({
      pullRequestDelivery: {
        expectedRepository: "caller-controlled-or-missing-owner",
        operatorIdentity: "fixture-operator",
        port: { async deliver() { return {} } },
      },
    })).toThrow("invalid_pull_request_delivery_repository")
  })

  test("reports process health without requiring Codex", async () => {
    const handler = createCoreHandler({
      inspectCodex: async () => {
        throw new Error("health must not inspect Codex")
      },
    })

    const response = await handler(new Request("http://podo.test/healthz"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      service: "podo-core",
      status: "ok",
      version: "0.0.0",
    })
  })

  test("reports Codex readiness through the system contract", async () => {
    const handler = createCoreHandler({
      inspectCodex: async () => ({
        binary: "codex",
        version: "0.144.1",
        rawVersion: "codex-cli 0.144.1",
      }),
    })

    const response = await handler(new Request("http://podo.test/readyz"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "ready",
      remediation: { configured: false },
      codex: {
        available: true,
        transport: "stdio",
        version: "0.144.1",
      },
    })
  })

  test("does not claim readiness when Codex is unavailable", async () => {
    const handler = createCoreHandler({
      inspectCodex: async () => {
        throw new Error("codex not found")
      },
    })

    const response = await handler(new Request("http://podo.test/readyz"))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: "degraded",
      codex: {
        available: false,
        error: "codex not found",
      },
    })
  })

  test("reads and atomically updates core-owned settings", async () => {
    const handler = createCoreHandler()

    const initial = await handler(new Request("http://podo.test/api/settings"))
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({
      settings: {
        autonomyMode: "observe",
        monitoringEnabled: true,
        defaultSandbox: "read-only",
        turnTimeoutMs: 60_000,
      },
    })

    const updated = await handler(new Request("http://podo.test/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autonomyMode: "act_with_approval", turnTimeoutMs: 90_000 }),
    }))
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      settings: { autonomyMode: "act_with_approval", turnTimeoutMs: 90_000 },
    })
  })

  test("rejects an invalid settings patch without partially applying it", async () => {
    const handler = createCoreHandler()
    const invalid = await handler(new Request("http://podo.test/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monitoringEnabled: false, defaultSandbox: "danger-full-access" }),
    }))

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: "invalid_settings" })
    const current = await handler(new Request("http://podo.test/api/settings"))
    expect(await current.json()).toMatchObject({
      settings: { monitoringEnabled: true, defaultSandbox: "read-only" },
    })
  })

  test("rejects empty, unknown, and out-of-range settings patches", async () => {
    const handler = createCoreHandler()
    for (const body of [
      {},
      { unexpected: true },
      { turnTimeoutMs: 999 },
      { turnTimeoutMs: 3_600_001 },
      { monitoringEnabled: "false" },
    ]) {
      const response = await handler(new Request("http://podo.test/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }))
      expect(response.status).toBe(400)
    }
  })

  test("rejects malformed telemetry envelopes without mutating incident state", async () => {
    const handler = createCoreHandler()
    for (const body of [{}, { events: [] }, { events: [null] }, { events: [], unexpected: true }]) {
      const response = await handler(new Request("http://podo.test/api/telemetry/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }))
      expect(response.status).toBe(400)
    }

    const incidents = await handler(new Request("http://podo.test/api/incidents"))
    expect(await incidents.json()).toEqual({ incidents: [] })
  })

  test("fails causal-path requests closed for invalid queries and unknown or unavailable state", async () => {
    const handler = createCoreHandler()
    const incident = await ingestCausalPathIncident(handler)
    const evidenceId = incident.evidence[0]!.id

    const controls = [
      { url: `/api/incidents/${incident.id}/causal-path`, status: 400, error: "invalid_request" },
      { url: `/api/incidents/${incident.id}/causal-path?evidenceId=${evidenceId}&evidenceId=other`, status: 400, error: "invalid_request" },
      { url: `/api/incidents/${incident.id}/causal-path?evidenceId=${evidenceId}&extra=true`, status: 400, error: "invalid_request" },
      { url: "/api/incidents/unknown/causal-path?evidenceId=unknown", status: 404, error: "incident_not_found" },
      { url: `/api/incidents/${incident.id}/causal-path?evidenceId=unknown`, status: 404, error: "evidence_not_found" },
      { url: `/api/incidents/${incident.id}/causal-path?evidenceId=${evidenceId}`, status: 503, error: "causal_path_unavailable" },
    ]

    for (const control of controls) {
      const response = await handler(new Request(`http://podo.test${control.url}`))
      const body = await response.json() as Record<string, unknown>
      expect(response.status).toBe(control.status)
      expect(body.error).toBe(control.error)
      expect(body.causalPath).toBeUndefined()
    }
  })

  test("returns one stable unresolved error for missing or ambiguous trusted graph provenance", async () => {
    const correlation = {
      deploymentId: "deploy-1042",
      containerId: "checkout-container",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      changedFileNodeId: "code:file:checkout-cache",
    }
    const validGraph = causalPathCodeGraph(correlation.changedFileNodeId)
    const configs: IncidentGraphConfig[] = [
      { codeGraph: validGraph, trustedCorrelations: [] },
      { codeGraph: validGraph, trustedCorrelations: [correlation, structuredClone(correlation)] },
      {
        codeGraph: validGraph,
        trustedCorrelations: [{ ...correlation, containerId: "wrong-container" }],
      },
      {
        codeGraph: ambiguousCausalPathCodeGraph(validGraph, correlation.changedFileNodeId),
        trustedCorrelations: [correlation],
      },
    ]

    for (const incidentGraph of configs) {
      const handler = createCoreHandler({ incidentGraph })
      const incident = await ingestCausalPathIncident(handler)
      const response = await handler(new Request(
        `http://podo.test/api/incidents/${incident.id}/causal-path?evidenceId=${incident.evidence[0]!.id}`,
      ))
      const body = await response.json() as Record<string, unknown>
      expect(response.status).toBe(409)
      expect(body.error).toBe("causal_path_unresolved")
      expect(body.causalPath).toBeUndefined()
    }
  })
})

const sharedRuntime: CodexRuntime = {
  async startThread() { return { threadId: "thread" } },
  async resumeThread() { return { threadId: "thread" } },
  async startTurn() { return { turnId: "turn" } },
  async steerTurn() { return { turnId: "turn" } },
  async interruptTurn() {},
  async resolveApproval() {},
  onEvent() { return () => undefined },
  async close() {},
}

async function ingestCausalPathIncident(handler: ReturnType<typeof createCoreHandler>) {
  const base = Date.parse("2026-07-14T09:00:00.000Z")
  const events = [
    ...[180, 310, 450, 620].map((mib, step) => ({
      timestamp: new Date(base + step * 1_000).toISOString(),
      kind: "metric",
      service: "checkout-service",
      severity: "warn",
      message: "process heap sample",
      deploymentId: "deploy-1042",
      containerId: "checkout-container",
      metric: { name: "process.heap.used", value: mib * 1024 * 1024, unit: "By" },
    })),
    {
      timestamp: new Date(base + 4_000).toISOString(),
      kind: "trace",
      service: "checkout-service",
      severity: "error",
      message: "POST /checkout returned 500",
      deploymentId: "deploy-1042",
      containerId: "checkout-container",
      traceId: "trace-1",
    },
    {
      timestamp: new Date(base + 5_000).toISOString(),
      kind: "log",
      service: "checkout-service",
      severity: "error",
      message: "JavaScript heap out of memory",
      deploymentId: "deploy-1042",
      containerId: "checkout-container",
      traceId: "trace-2",
    },
  ]
  const response = await handler(new Request("http://podo.test/api/telemetry/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  }))
  expect(response.status).toBe(200)
  const body = await response.json() as { incident: { id: string; evidence: Array<{ id: string }> } | null }
  if (!body.incident) throw new Error("expected causal-path incident")
  return body.incident
}

function causalPathCodeGraph(fileNodeId: string): NormalizedCodeGraphSnapshot {
  return {
    id: "graph-causal-path-handler",
    schemaVersion: PODO_CODE_GRAPH_SCHEMA_VERSION,
    source: { provider: "injected-test", graphId: "checkout", schemaVersion: "1" },
    nodes: [
      { id: fileNodeId, externalId: "external:file", kind: "file", label: "cache.ts", provenance: "extracted" },
      { id: "code:function:checkout-cache-set", externalId: "external:function", kind: "function", label: "CheckoutCache.set", provenance: "extracted" },
    ],
    links: [{
      id: "code:link:file-function",
      externalId: "external:file-function",
      type: "CONTAINS",
      fromNodeId: fileNodeId,
      toNodeId: "code:function:checkout-cache-set",
      fromExternalId: "external:file",
      toExternalId: "external:function",
      provenance: "extracted",
    }],
  }
}

function ambiguousCausalPathCodeGraph(
  graph: NormalizedCodeGraphSnapshot,
  fileNodeId: string,
): NormalizedCodeGraphSnapshot {
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id: "code:function:other", externalId: "external:other", kind: "function", label: "Other.set", provenance: "extracted" },
    ],
    links: [
      ...graph.links,
      {
        id: "code:link:file-other-function",
        externalId: "external:file-other-function",
        type: "CONTAINS",
        fromNodeId: fileNodeId,
        toNodeId: "code:function:other",
        fromExternalId: "external:file",
        toExternalId: "external:other",
        provenance: "extracted",
      },
    ],
  }
}
