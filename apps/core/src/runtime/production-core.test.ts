import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { createProductionCoreHandler } from "./production-core"

const enabledEnvironment = {
  PODO_INCIDENT_GRAPH_ENABLED: "true",
  PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: fileURLToPath(new URL(
    "../../../../scenarios/cache-growth/graph-bootstrap.json",
    import.meta.url,
  )),
}

test("production composition resolves the canonical cache-growth causal path", async () => {
  const handler = await createProductionCoreHandler(enabledEnvironment)
  const telemetry = await Bun.file(new URL(
    "../../../../scenarios/cache-growth/fixtures/telemetry.json",
    import.meta.url,
  )).json()

  const ingested = await handler(new Request("http://podo.test/api/telemetry/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: telemetry }),
  }))
  const ingestBody = await ingested.json() as {
    incident: { id: string; evidence: Array<{ id: string }> } | null
  }
  expect(ingested.status).toBe(200)
  expect(ingestBody.incident).not.toBeNull()

  const incident = ingestBody.incident!
  const response = await handler(new Request(
    `http://podo.test/api/incidents/${incident.id}/causal-path?evidenceId=${incident.evidence[0]!.id}`,
  ))

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    causalPath: {
      container: { id: "checkout-service-7b9c" },
      deployment: { id: "deploy-1042" },
      commit: { sha: "d34db33fd34db33fd34db33fd34db33fd34db33f" },
      file: {
        label: "cache.ts",
        location: { path: "demo/services/checkout-service/src/cache.ts" },
      },
      function: {
        label: "CheckoutCache",
        location: { path: "demo/services/checkout-service/src/cache.ts" },
      },
    },
  })
})

test("production composition keeps the incident graph disabled by default", async () => {
  let receivedIncidentGraph: unknown = "not-called"
  await createProductionCoreHandler({}, {
    createHandler(options) {
      receivedIncidentGraph = options.incidentGraph
      return async () => new Response()
    },
  })

  expect(receivedIncidentGraph).toBeUndefined()
})

test("production composition injects the opt-in read-only agent chat", async () => {
  let receivedAgentChat: unknown
  await createProductionCoreHandler({ PODO_AGENT_CHAT_ENABLED: "true", PODO_AGENT_CHAT_CWD: "/configured/repository" }, {
    agentChat: { async resolveDirectory() { return "/canonical/repository" } },
    createHandler(options) {
      receivedAgentChat = options.agentChat
      return async () => new Response()
    },
  })
  expect(receivedAgentChat).toEqual({ cwd: "/canonical/repository" })
})

test("production composition injects the opt-in GitHub issue fallback", async () => {
  let receivedIssueDelivery: unknown
  await createProductionCoreHandler({
    PODO_GITHUB_ISSUE_ENABLED: "true",
    PODO_GITHUB_TOKEN: "github-token",
    PODO_GITHUB_REPOSITORY: "owner/repository",
  }, {
    githubIssue: {
      createAdapter() {
        return {
          async create() {
            throw new Error("not invoked during composition")
          },
        }
      },
    },
    createHandler(options) {
      receivedIssueDelivery = options.issueDelivery
      return async () => new Response()
    },
  })

  expect(receivedIssueDelivery).toMatchObject({
    expectedRepository: "owner/repository",
    port: { create: expect.any(Function) },
  })
})

test("production composition fails before creating a handler when graph bootstrap is invalid", async () => {
  let createdHandler = false
  const creation = createProductionCoreHandler(enabledEnvironment, {
    incidentGraph: {
      async readJson() {
        throw new Error("private filesystem detail")
      },
    },
    createHandler() {
      createdHandler = true
      return async () => new Response()
    },
  })

  await expect(creation).rejects.toThrow("invalid_production_incident_graph_config")
  expect(createdHandler).toBe(false)
})
