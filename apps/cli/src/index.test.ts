import { describe, expect, test } from "bun:test"
import type { PodoIncidentClient } from "@podo/client"
import { runCli } from "./index"

const settings = {
  autonomyMode: "observe" as const,
  monitoringEnabled: true,
  defaultSandbox: "read-only" as const,
  turnTimeoutMs: 60_000,
}

function client(
  overrides: Partial<PodoIncidentClient> = {},
): PodoIncidentClient {
  return {
    health: async () => ({ service: "podo-core", status: "ok", version: "0.0.0" }),
    systemStatus: async () => { throw new Error("unused") },
    getSettings: async () => ({ settings }),
    updateSettings: async (patch) => ({ settings: { ...settings, ...patch } }),
    ingestTelemetry: async () => { throw new Error("unused") },
    listIncidents: async () => ({ incidents: [] }),
    getIncident: async () => { throw new Error("unused") },
    getIncidentCausalPath: async () => { throw new Error("unused") },
    startIncidentInvestigation: async () => { throw new Error("unused") },
    start: async () => { throw new Error("unused") },
    get: async () => { throw new Error("unused") },
    cancel: async () => { throw new Error("unused") },
    startInvestigation: async () => { throw new Error("unused") },
    getInvestigation: async () => { throw new Error("unused") },
    cancelInvestigation: async () => { throw new Error("unused") },
    approve: async () => { throw new Error("unused") },
    deny: async () => { throw new Error("unused") },
    subscribeEvents: () => { throw new Error("unused") },
    ...overrides,
  }
}

describe("Podo CLI config", () => {
  test("prints settings as JSON", async () => {
    const stdout: string[] = []
    const exitCode = await runCli(["config", "show"], { client: client(), stdout: (line) => stdout.push(line) })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.join("\n"))).toEqual({ settings })
  })

  test("parses typed values before updating settings", async () => {
    const patches: unknown[] = []
    const stdout: string[] = []
    const fake = client({
      updateSettings: async (patch) => {
        patches.push(patch)
        return { settings: { ...settings, ...patch } }
      },
    })

    expect(await runCli(["config", "set", "monitoringEnabled", "false"], { client: fake, stdout: (line) => stdout.push(line) })).toBe(0)
    expect(await runCli(["config", "set", "turnTimeoutMs", "90000"], { client: fake, stdout: (line) => stdout.push(line) })).toBe(0)
    expect(patches).toEqual([{ monitoringEnabled: false }, { turnTimeoutMs: 90_000 }])
  })

  test("fails locally on invalid keys and values", async () => {
    let called = false
    const fake = client({ updateSettings: async () => { called = true; return { settings } } })
    const stderr: string[] = []

    expect(await runCli(["config", "set", "monitoringEnabled", "yes"], { client: fake, stderr: (line) => stderr.push(line) })).toBe(1)
    expect(await runCli(["config", "set", "unknown", "x"], { client: fake, stderr: (line) => stderr.push(line) })).toBe(1)
    expect(called).toBe(false)
    expect(stderr).toHaveLength(2)
  })

  test("lists incidents through the typed client", async () => {
    const stdout: string[] = []
    const incident = {
      id: "incident-1",
      status: "detected" as const,
      detector: "cache_growth" as const,
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
      createdAt: "2026-07-14T09:00:00.000Z",
      updatedAt: "2026-07-14T09:01:00.000Z",
      evidence: [],
    }
    const exitCode = await runCli(["incidents", "list"], {
      client: client({ listIncidents: async () => ({ incidents: [incident] }) }),
      stdout: (line) => stdout.push(line),
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.join("\n"))).toEqual({ incidents: [incident] })
  })
})

const incident = {
  id: "incident/1",
  status: "detected" as const,
  detector: "cache_growth" as const,
  affectedService: "checkout-service",
  deploymentId: "deploy-1042",
  createdAt: "2026-07-14T09:00:00.000Z",
  updatedAt: "2026-07-14T09:01:00.000Z",
  evidence: [],
}

const investigation = {
  id: "investigation-1",
  status: "starting" as const,
  cwd: "/workspace/podo",
  sandbox: "read-only" as const,
  createdAt: "2026-07-14T09:02:00.000Z",
  updatedAt: "2026-07-14T09:02:00.000Z",
  lastSequence: 0,
  pendingApproval: null,
}

const causalPath = {
  schemaVersion: "podo.causal-path.v1" as const,
  id: "path-1",
  incident: { id: "incident/1" },
  evidence: { id: "evidence?1" },
  telemetryEvent: {
    id: "event-1",
    occurredAt: "2026-07-14T09:00:30.000Z",
  },
  container: { id: "container-1" },
  deployment: { id: "deployment-1" },
  commit: { id: "commit-1", sha: "abc123" },
  file: {
    id: "file-1",
    kind: "file" as const,
    externalId: "src/cache.ts",
    label: "src/cache.ts",
  },
  function: {
    id: "function-1",
    kind: "function" as const,
    externalId: "retainCacheEntry",
    label: "retainCacheEntry",
  },
}

describe("Podo CLI incidents", () => {
  test("shows one incident through the typed client", async () => {
    const calls: string[] = []
    const stdout: string[] = []

    const exitCode = await runCli(["incidents", "show", "incident/1"], {
      client: client({
        getIncident: async (id) => {
          calls.push(id)
          return { incident }
        },
      }),
      stdout: (line) => stdout.push(line),
    })

    expect(exitCode).toBe(0)
    expect(calls).toEqual(["incident/1"])
    expect(stdout).toEqual([JSON.stringify({ incident }, null, 2)])
  })

  test("resolves a causal path without encoding identities in the CLI", async () => {
    const calls: Array<[string, string]> = []
    const stdout: string[] = []

    const exitCode = await runCli(
      ["incidents", "path", "incident/1", "evidence?1"],
      {
        client: client({
          getIncidentCausalPath: async (incidentId, evidenceId) => {
            calls.push([incidentId, evidenceId])
            return { causalPath }
          },
        }),
        stdout: (line) => stdout.push(line),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([["incident/1", "evidence?1"]])
    expect(stdout).toEqual([JSON.stringify({ causalPath }, null, 2)])
  })

  test("starts an incident investigation with the exact absolute cwd", async () => {
    const calls: Array<[string, { cwd: string }]> = []
    const stdout: string[] = []

    const exitCode = await runCli(
      ["incidents", "investigate", "incident/1", "/workspace/podo"],
      {
        client: client({
          startIncidentInvestigation: async (incidentId, input) => {
            calls.push([incidentId, input])
            return { incident, investigation }
          },
        }),
        stdout: (line) => stdout.push(line),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([
      ["incident/1", { cwd: "/workspace/podo" }],
    ])
    expect(stdout).toEqual([
      JSON.stringify({ incident, investigation }, null, 2),
    ])
  })

  test.each([
    [
      "show without an id",
      ["incidents", "show"],
      "Invalid arguments. Usage: podo incidents show <incidentId>",
    ],
    [
      "show with a blank id",
      ["incidents", "show", " "],
      "Invalid arguments. Usage: podo incidents show <incidentId>",
    ],
    [
      "show with extra args",
      ["incidents", "show", "incident-1", "extra"],
      "Invalid arguments. Usage: podo incidents show <incidentId>",
    ],
    [
      "path without evidence",
      ["incidents", "path", "incident-1"],
      "Invalid arguments. Usage: podo incidents path <incidentId> <evidenceId>",
    ],
    [
      "path with blank evidence",
      ["incidents", "path", "incident-1", " "],
      "Invalid arguments. Usage: podo incidents path <incidentId> <evidenceId>",
    ],
    [
      "path with extra args",
      ["incidents", "path", "incident-1", "evidence-1", "extra"],
      "Invalid arguments. Usage: podo incidents path <incidentId> <evidenceId>",
    ],
    [
      "investigate without cwd",
      ["incidents", "investigate", "incident-1"],
      "Invalid arguments. Usage: podo incidents investigate <incidentId> <absolute-cwd>",
    ],
    [
      "investigate with relative cwd",
      ["incidents", "investigate", "incident-1", "repo"],
      "Invalid arguments. Usage: podo incidents investigate <incidentId> <absolute-cwd>",
    ],
    [
      "investigate with extra args",
      ["incidents", "investigate", "incident-1", "/repo", "extra"],
      "Invalid arguments. Usage: podo incidents investigate <incidentId> <absolute-cwd>",
    ],
  ])("fails locally for %s", async (_label, args, expectedError) => {
    let calls = 0
    const stdout: string[] = []
    const stderr: string[] = []
    const fake = client({
      getIncident: async () => { calls += 1; return { incident } },
      getIncidentCausalPath: async () => { calls += 1; return { causalPath } },
      startIncidentInvestigation: async () => {
        calls += 1
        return { incident, investigation }
      },
    })

    expect(
      await runCli(args, {
        client: fake,
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      }),
    ).toBe(1)
    expect(calls).toBe(0)
    expect(stdout).toEqual([])
    expect(stderr).toEqual([expectedError])
  })

  test("leaves client failures for the top-level error boundary", async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    await expect(
      runCli(["incidents", "show", "incident-1"], {
        client: client({
          getIncident: async () => {
            throw new Error("Podo request failed (503): unavailable")
          },
        }),
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      }),
    ).rejects.toThrow("Podo request failed (503): unavailable")
    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
  })
})
