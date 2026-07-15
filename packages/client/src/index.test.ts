import { describe, expect, test } from "bun:test"
import { createPodoClient } from "./index"

describe("createPodoClient", () => {
  test("normalizes the base URL and decodes health responses", async () => {
    const requestedUrls: string[] = []
    const client = createPodoClient({
      baseUrl: "http://podo.test/",
      fetch: async (input) => {
        requestedUrls.push(String(input))
        return Response.json({ service: "podo-core", status: "ok", version: "0.0.0" })
      },
    })

    await expect(client.health()).resolves.toEqual({
      service: "podo-core",
      status: "ok",
      version: "0.0.0",
    })
    expect(requestedUrls).toEqual(["http://podo.test/healthz"])
  })

  test("uses the public investigation command contract", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []
    const client = createPodoClient({
      baseUrl: "http://podo.test",
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
        return Response.json({ investigation: { id: "inv-1" }, approval: { id: "approval-1" } })
      },
    })
    await client.startInvestigation({ prompt: "investigate", cwd: "/repo", sandbox: "workspace-write" })
    await client.getInvestigation("inv-1")
    await client.approve("inv-1", "approval-1")
    await client.deny("inv-1", "approval-2")
    await client.cancelInvestigation("inv-1")
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST http://podo.test/api/investigations",
      "GET http://podo.test/api/investigations/inv-1",
      "POST http://podo.test/api/investigations/inv-1/approvals/approval-1",
      "POST http://podo.test/api/investigations/inv-1/approvals/approval-2",
      "DELETE http://podo.test/api/investigations/inv-1",
    ])
    expect(requests[2]?.body).toEqual({ decision: "approve" })
    expect(requests[3]?.body).toEqual({ decision: "deny" })
  })

  test("starts an incident investigation without accepting prompt, evidence, sandbox, mode, or approval", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []
    const client = createPodoClient({
      baseUrl: "http://podo.test",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        })
        return Response.json({ incident: { id: "incident-1" }, investigation: { id: "inv-1" } })
      },
    })

    await client.startIncidentInvestigation("incident/1", { cwd: "/repo" })
    await client.getIncidentAudit("incident/1")

    expect(requests).toEqual([
      {
        url: "http://podo.test/api/incidents/incident%2F1/investigation",
        method: "POST",
        body: { cwd: "/repo" },
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/audit",
        method: "GET",
      },
    ])
  })

  test("reads an evidence-specific causal path with encoded identities", async () => {
    const requestedUrls: string[] = []
    const client = createPodoClient({
      baseUrl: "http://podo.test/",
      fetch: async (input) => {
        requestedUrls.push(String(input))
        return Response.json({ causalPath: { schemaVersion: "podo.causal-path.v1", id: "path-1" } })
      },
    })

    await client.getIncidentCausalPath("incident/1", "evidence?1")

    expect(requestedUrls).toEqual([
      "http://podo.test/api/incidents/incident%2F1/causal-path?evidenceId=evidence%3F1",
    ])
  })

  test("uses the core-owned incident remediation lifecycle without caller-authored state", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []
    const client = createPodoClient({
      baseUrl: "http://podo.test/",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        })
        return Response.json({ remediation: { id: "remediation-1" } })
      },
    })

    await client.startIncidentRemediation("incident/1")
    await client.getIncidentRemediation("incident/1")
    await client.getIncidentRemediationAudit("incident/1")
    await client.approveIncidentRemediation("incident/1", "approval/1")
    await client.denyIncidentRemediation("incident/1", "approval/2")
    await client.startIncidentDelivery("incident/1")
    await client.getIncidentDelivery("incident/1")
    await client.approveIncidentDelivery("incident/1", "delivery-approval/1")
    await client.denyIncidentDelivery("incident/1", "delivery-approval/2")

    expect(requests).toEqual([
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation",
        method: "POST",
        body: {},
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation",
        method: "GET",
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/audit",
        method: "GET",
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/approvals/approval%2F1",
        method: "POST",
        body: { decision: "approve" },
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/approvals/approval%2F2",
        method: "POST",
        body: { decision: "deny" },
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/delivery",
        method: "POST",
        body: {},
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/delivery",
        method: "GET",
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/delivery/approvals/delivery-approval%2F1",
        method: "POST",
        body: { decision: "approve" },
      },
      {
        url: "http://podo.test/api/incidents/incident%2F1/remediation/delivery/approvals/delivery-approval%2F2",
        method: "POST",
        body: { decision: "deny" },
      },
    ])
  })

  test("reads and updates the public settings contract", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []
    const client = createPodoClient({
      baseUrl: "http://podo.test/",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        })
        return Response.json({
          settings: {
            autonomyMode: "recommend",
            monitoringEnabled: true,
            defaultSandbox: "read-only",
            turnTimeoutMs: 60_000,
          },
        })
      },
    })

    await client.getSettings()
    await client.updateSettings({ autonomyMode: "recommend", monitoringEnabled: false })

    expect(requests).toEqual([
      { url: "http://podo.test/api/settings", method: "GET" },
      {
        url: "http://podo.test/api/settings",
        method: "PATCH",
        body: { autonomyMode: "recommend", monitoringEnabled: false },
      },
    ])
  })

  test("decodes partial SSE frames and sends replay cursor", async () => {
    let headers: HeadersInit | undefined
    const encoder = new TextEncoder()
    const client = createPodoClient({
      fetch: async (_input, init) => {
        headers = init?.headers
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('id: 3\nevent: output.delta\ndata: {"investigationId":"i","sequence":3,"timestamp":"t","kind":"output.'))
            controller.enqueue(encoder.encode('delta","payload":{"text":"x"}}\n\nid: 4\ndata: {"investigationId":"i","sequence":4,"timestamp":"t","kind":"investigation.completed","payload":{"status":"completed"}}\n\n'))
            controller.close()
          },
        }), { headers: { "content-type": "text/event-stream" } })
      },
    })
    const events = []
    for await (const event of client.subscribeEvents("i", { afterSequence: 2 })) events.push(event)
    expect(events.map((event) => [event.sequence, event.kind])).toEqual([[3, "output.delta"], [4, "investigation.completed"]])
    expect(new Headers(headers).get("last-event-id")).toBe("2")
  })

  test("decodes CRLF event boundaries split across chunks", async () => {
    const encoder = new TextEncoder()
    const client = createPodoClient({
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('id: 1\r\ndata: {"investigationId":"i","sequence":1,"timestamp":"t","kind":"investigation.completed","payload":{"status":"completed"}}\r'))
          controller.enqueue(encoder.encode('\n\r'))
          controller.enqueue(encoder.encode('\n'))
          controller.close()
        },
      })),
    })
    const events = []
    for await (const event of client.subscribeEvents("i")) events.push(event)
    expect(events.map((event) => event.sequence)).toEqual([1])
  })
})
