import { describe, expect, test } from "bun:test"
import type { PodoIncidentClient, PodoRemediationClient } from "@podo/client"
import { runCli } from "./index"

type CliClient = PodoIncidentClient & PodoRemediationClient

const settings = {
  autonomyMode: "observe" as const,
  monitoringEnabled: true,
  defaultSandbox: "read-only" as const,
  turnTimeoutMs: 60_000,
}

function client(
  overrides: Partial<CliClient> = {},
): CliClient {
  return {
    health: async () => ({ service: "podo-core", status: "ok", version: "0.0.0" }),
    systemStatus: async () => { throw new Error("unused") },
    getSettings: async () => ({ settings }),
    updateSettings: async (patch) => ({ settings: { ...settings, ...patch } }),
    ingestTelemetry: async () => { throw new Error("unused") },
    listIncidents: async () => ({ incidents: [] }),
    getIncident: async () => { throw new Error("unused") },
    getIncidentEvidence: async () => { throw new Error("unused") },
    getIncidentCausalPath: async () => { throw new Error("unused") },
    getIncidentTelemetryComparison: async () => { throw new Error("unused") },
    startIncidentInvestigation: async () => { throw new Error("unused") },
    startIncidentRemediation: async () => { throw new Error("unused") },
    getIncidentRemediation: async () => { throw new Error("unused") },
    getIncidentRemediationAudit: async () => { throw new Error("unused") },
    approveIncidentRemediation: async () => { throw new Error("unused") },
    denyIncidentRemediation: async () => { throw new Error("unused") },
    startIncidentDelivery: async () => { throw new Error("unused") },
    getIncidentDelivery: async () => { throw new Error("unused") },
    approveIncidentDelivery: async () => { throw new Error("unused") },
    denyIncidentDelivery: async () => { throw new Error("unused") },
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
  test("documents the separate delivery approval lifecycle in help", async () => {
    const stdout: string[] = []

    expect(await runCli(["help"], {
      client: client(),
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(stdout).toHaveLength(1)
    expect(stdout[0]).toContain("podo incidents deliver <incidentId>")
    expect(stdout[0]).toContain("podo incidents delivery <incidentId>")
    expect(stdout[0]).toContain("podo incidents approve-delivery <incidentId> <approvalId>")
    expect(stdout[0]).toContain("podo incidents deny-delivery <incidentId> <approvalId>")
    expect(stdout[0]).toContain("podo incidents comparison <incidentId>")
  })

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

const remediation = {
  id: "remediation-1",
  incidentId: "incident/1",
  status: "pending_approval" as const,
  target: "isolated_checkout" as const,
  approval: {
    id: "approval/1",
    status: "pending" as const,
  },
  createdAt: "2026-07-14T09:03:00.000Z",
  updatedAt: "2026-07-14T09:03:00.000Z",
}

const delivery = {
  id: "delivery-1",
  incidentId: "incident/1",
  remediationId: "remediation-1",
  artifactId: "artifact-1",
  status: "pending_approval" as const,
  approval: {
    id: "delivery-approval/1",
    status: "pending" as const,
  },
  createdAt: "2026-07-14T09:04:00.000Z",
  updatedAt: "2026-07-14T09:04:00.000Z",
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

  test("prints the Core-owned telemetry comparison as stable JSON", async () => {
    const calls: string[] = []
    const stdout: string[] = []
    const comparison = {
      schemaVersion: "podo.telemetry-comparison.v1" as const,
      comparisonId: "telemetry_comparison_0123456789abcdef01234567",
      service: "checkout-service",
      metric: {
        name: "process.heap.used",
        unit: "By",
        stableChangeLimit: 16 * 1024 * 1024,
      },
      before: {
        eventCount: 22,
        metricSamples: 15,
        firstValue: 180,
        lastValue: 642,
        peakValue: 642,
        changeValue: 462,
        errorEvents: 6,
        deploymentIds: ["deploy-1041", "deploy-1042"],
      },
      after: {
        eventCount: 13,
        metricSamples: 12,
        firstValue: 180,
        lastValue: 180,
        peakValue: 180,
        changeValue: 0,
        errorEvents: 0,
        deploymentIds: ["deploy-1043"],
      },
      verdict: {
        status: "stabilized" as const,
        heapGrowthStable: true,
        peakDidNotIncrease: true,
        errorsDidNotIncrease: true,
        improved: true,
      },
    }
    const provenance = {
      replayId: "replay_post_fix_1",
      remediationId: "remediation_1",
      artifactId: "artifact_1",
      headSha: "d".repeat(40),
      afterEventCount: 13,
    }

    const exitCode = await runCli(
      ["incidents", "comparison", "incident/1"],
      {
        client: client({
          getIncidentTelemetryComparison: async (incidentId) => {
            calls.push(incidentId)
            return { comparison, provenance }
          },
        }),
        stdout: (line) => stdout.push(line),
      },
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual(["incident/1"])
    expect(stdout).toEqual([
      JSON.stringify({ comparison, provenance }, null, 2),
    ])
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

  test("routes remediation lifecycle commands through the typed client", async () => {
    const calls: Array<[string, ...string[]]> = []
    const stdout: string[] = []
    const fake = client({
      startIncidentRemediation: async (incidentId) => {
        calls.push(["remediate", incidentId])
        return { remediation }
      },
      getIncidentRemediation: async (incidentId) => {
        calls.push(["remediation", incidentId])
        return { remediation }
      },
      approveIncidentRemediation: async (incidentId, approvalId) => {
        calls.push(["approve-remediation", incidentId, approvalId])
        return { remediation }
      },
      denyIncidentRemediation: async (incidentId, approvalId) => {
        calls.push(["deny-remediation", incidentId, approvalId])
        return { remediation }
      },
    })

    expect(await runCli(["incidents", "remediate", "incident/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(await runCli(["incidents", "remediation", "incident/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(await runCli(["incidents", "approve-remediation", "incident/1", "approval/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(await runCli(["incidents", "deny-remediation", "incident/1", "approval/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)

    expect(calls).toEqual([
      ["remediate", "incident/1"],
      ["remediation", "incident/1"],
      ["approve-remediation", "incident/1", "approval/1"],
      ["deny-remediation", "incident/1", "approval/1"],
    ])
    expect(stdout).toEqual(Array.from({ length: 4 }, () => (
      JSON.stringify({ remediation }, null, 2)
    )))
  })

  test("routes the separately approved delivery lifecycle through the typed client", async () => {
    const calls: Array<[string, ...string[]]> = []
    const stdout: string[] = []
    const fake = client({
      startIncidentDelivery: async (incidentId) => {
        calls.push(["deliver", incidentId])
        return { delivery }
      },
      getIncidentDelivery: async (incidentId) => {
        calls.push(["delivery", incidentId])
        return { delivery }
      },
      approveIncidentDelivery: async (incidentId, approvalId) => {
        calls.push(["approve-delivery", incidentId, approvalId])
        return { delivery }
      },
      denyIncidentDelivery: async (incidentId, approvalId) => {
        calls.push(["deny-delivery", incidentId, approvalId])
        return { delivery }
      },
    })

    expect(await runCli(["incidents", "deliver", "incident/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(await runCli(["incidents", "delivery", "incident/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(await runCli(["incidents", "approve-delivery", "incident/1", "delivery-approval/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)
    expect(await runCli(["incidents", "deny-delivery", "incident/1", "delivery-approval/1"], {
      client: fake,
      stdout: (line) => stdout.push(line),
    })).toBe(0)

    expect(calls).toEqual([
      ["deliver", "incident/1"],
      ["delivery", "incident/1"],
      ["approve-delivery", "incident/1", "delivery-approval/1"],
      ["deny-delivery", "incident/1", "delivery-approval/1"],
    ])
    expect(stdout).toEqual(Array.from({ length: 4 }, () => (
      JSON.stringify({ delivery }, null, 2)
    )))
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
      "comparison without an id",
      ["incidents", "comparison"],
      "Invalid arguments. Usage: podo incidents comparison <incidentId>",
    ],
    [
      "comparison with a blank id",
      ["incidents", "comparison", " "],
      "Invalid arguments. Usage: podo incidents comparison <incidentId>",
    ],
    [
      "comparison with extra args",
      ["incidents", "comparison", "incident-1", "extra"],
      "Invalid arguments. Usage: podo incidents comparison <incidentId>",
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
    [
      "remediate without an id",
      ["incidents", "remediate"],
      "Invalid arguments. Usage: podo incidents remediate <incidentId>",
    ],
    [
      "remediate with a blank id",
      ["incidents", "remediate", " "],
      "Invalid arguments. Usage: podo incidents remediate <incidentId>",
    ],
    [
      "remediate with extra args",
      ["incidents", "remediate", "incident-1", "extra"],
      "Invalid arguments. Usage: podo incidents remediate <incidentId>",
    ],
    [
      "remediation without an id",
      ["incidents", "remediation"],
      "Invalid arguments. Usage: podo incidents remediation <incidentId>",
    ],
    [
      "remediation with a blank id",
      ["incidents", "remediation", " "],
      "Invalid arguments. Usage: podo incidents remediation <incidentId>",
    ],
    [
      "remediation with extra args",
      ["incidents", "remediation", "incident-1", "extra"],
      "Invalid arguments. Usage: podo incidents remediation <incidentId>",
    ],
    [
      "approve-remediation without an approval id",
      ["incidents", "approve-remediation", "incident-1"],
      "Invalid arguments. Usage: podo incidents approve-remediation <incidentId> <approvalId>",
    ],
    [
      "approve-remediation with a blank approval id",
      ["incidents", "approve-remediation", "incident-1", " "],
      "Invalid arguments. Usage: podo incidents approve-remediation <incidentId> <approvalId>",
    ],
    [
      "approve-remediation with extra args",
      ["incidents", "approve-remediation", "incident-1", "approval-1", "extra"],
      "Invalid arguments. Usage: podo incidents approve-remediation <incidentId> <approvalId>",
    ],
    [
      "deny-remediation without an approval id",
      ["incidents", "deny-remediation", "incident-1"],
      "Invalid arguments. Usage: podo incidents deny-remediation <incidentId> <approvalId>",
    ],
    [
      "deny-remediation with a blank incident id",
      ["incidents", "deny-remediation", " ", "approval-1"],
      "Invalid arguments. Usage: podo incidents deny-remediation <incidentId> <approvalId>",
    ],
    [
      "deny-remediation with extra args",
      ["incidents", "deny-remediation", "incident-1", "approval-1", "extra"],
      "Invalid arguments. Usage: podo incidents deny-remediation <incidentId> <approvalId>",
    ],
    [
      "deliver without an id",
      ["incidents", "deliver"],
      "Invalid arguments. Usage: podo incidents deliver <incidentId>",
    ],
    [
      "deliver with a blank id",
      ["incidents", "deliver", " "],
      "Invalid arguments. Usage: podo incidents deliver <incidentId>",
    ],
    [
      "deliver with extra args",
      ["incidents", "deliver", "incident-1", "extra"],
      "Invalid arguments. Usage: podo incidents deliver <incidentId>",
    ],
    [
      "delivery without an id",
      ["incidents", "delivery"],
      "Invalid arguments. Usage: podo incidents delivery <incidentId>",
    ],
    [
      "delivery with a blank id",
      ["incidents", "delivery", " "],
      "Invalid arguments. Usage: podo incidents delivery <incidentId>",
    ],
    [
      "delivery with extra args",
      ["incidents", "delivery", "incident-1", "extra"],
      "Invalid arguments. Usage: podo incidents delivery <incidentId>",
    ],
    [
      "approve-delivery without an approval id",
      ["incidents", "approve-delivery", "incident-1"],
      "Invalid arguments. Usage: podo incidents approve-delivery <incidentId> <approvalId>",
    ],
    [
      "approve-delivery with a blank approval id",
      ["incidents", "approve-delivery", "incident-1", " "],
      "Invalid arguments. Usage: podo incidents approve-delivery <incidentId> <approvalId>",
    ],
    [
      "approve-delivery with extra args",
      ["incidents", "approve-delivery", "incident-1", "approval-1", "extra"],
      "Invalid arguments. Usage: podo incidents approve-delivery <incidentId> <approvalId>",
    ],
    [
      "deny-delivery without an approval id",
      ["incidents", "deny-delivery", "incident-1"],
      "Invalid arguments. Usage: podo incidents deny-delivery <incidentId> <approvalId>",
    ],
    [
      "deny-delivery with a blank incident id",
      ["incidents", "deny-delivery", " ", "approval-1"],
      "Invalid arguments. Usage: podo incidents deny-delivery <incidentId> <approvalId>",
    ],
    [
      "deny-delivery with extra args",
      ["incidents", "deny-delivery", "incident-1", "approval-1", "extra"],
      "Invalid arguments. Usage: podo incidents deny-delivery <incidentId> <approvalId>",
    ],
  ])("fails locally for %s", async (_label, args, expectedError) => {
    let calls = 0
    const stdout: string[] = []
    const stderr: string[] = []
    const fake = client({
      getIncident: async () => { calls += 1; return { incident } },
      getIncidentCausalPath: async () => { calls += 1; return { causalPath } },
      getIncidentTelemetryComparison: async () => {
        calls += 1
        throw new Error("unexpected")
      },
      startIncidentInvestigation: async () => {
        calls += 1
        return { incident, investigation }
      },
      startIncidentRemediation: async () => { calls += 1; return { remediation } },
      getIncidentRemediation: async () => { calls += 1; return { remediation } },
      approveIncidentRemediation: async () => { calls += 1; return { remediation } },
      denyIncidentRemediation: async () => { calls += 1; return { remediation } },
      startIncidentDelivery: async () => { calls += 1; return { delivery } },
      getIncidentDelivery: async () => { calls += 1; return { delivery } },
      approveIncidentDelivery: async () => { calls += 1; return { delivery } },
      denyIncidentDelivery: async () => { calls += 1; return { delivery } },
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
      runCli(["incidents", "approve-delivery", "incident-1", "approval-1"], {
        client: client({
          approveIncidentDelivery: async () => {
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
