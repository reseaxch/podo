import { describe, expect, test } from "bun:test"

import {
  selectIncident,
  shouldAbortActiveStream,
  shouldReplaceInvestigation,
  toPodoSettings,
  toTuiActivity,
  toTuiRunStatus,
  toTuiSettings,
  toTuiViewModel,
} from "./connected"

const settings = {
  autonomyMode: "act_with_approval" as const,
  monitoringEnabled: false,
  defaultSandbox: "workspace-write" as const,
  turnTimeoutMs: 90_000,
}

describe("connected TUI adapter", () => {
  test("maps shared settings without changing wire values", () => {
    expect(toPodoSettings(toTuiSettings(settings))).toEqual(settings)
  })

  test("maps core readiness and incident evidence into the terminal view model", () => {
    const viewModel = toTuiViewModel(
      {
        service: "podo-core",
        status: "ready",
        version: "0.0.0",
        codex: { available: true, binary: "codex", transport: "stdio", version: "0.142.0" },
        remediation: { configured: false },
      },
      settings,
      [{
        id: "incident-1",
        status: "detected",
        detector: "cache_growth",
        affectedService: "checkout-service",
        deploymentId: "deploy-1042",
        createdAt: "2026-07-14T09:00:00.000Z",
        updatedAt: "2026-07-14T09:01:00.000Z",
        evidence: [{
          id: "evidence-1",
          sourceEventId: "telemetry-1",
          sourceType: "metric",
          observedAt: "2026-07-14T09:00:00.000Z",
          service: "checkout-service",
          deploymentId: "deploy-1042",
        }],
      }],
    )

    expect(viewModel.status).toBe("idle")
    expect(viewModel.incidentTitle).toBe("checkout-service · cache_growth")
    expect(viewModel.evidence).toEqual(["metric: telemetry-1"])
    expect(viewModel.settings.mode).toBe("act_with_approval")
  })

  test("maps a Core starting investigation to an explicit TUI loading state", () => {
    expect(toTuiRunStatus("starting")).toBe("loading")
  })

  test("prioritizes a Core-linked incident and exposes approval metadata without its raw content", () => {
    const linkedIncident = {
      id: "incident-linked",
      status: "detected" as const,
      detector: "cache_growth" as const,
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
      createdAt: "2026-07-14T09:00:00.000Z",
      updatedAt: "2026-07-14T09:01:00.000Z",
      evidence: [],
      investigation: {
        id: "investigation-1",
        status: "waiting_for_approval" as const,
        startedAt: "2026-07-14T09:00:00.000Z",
        updatedAt: "2026-07-14T09:01:00.000Z",
      },
    }
    const { investigation: _linkedInvestigation, ...unlinkedIncident } = linkedIncident
    const newerUnlinkedIncident = { ...unlinkedIncident, id: "incident-newer" }
    const currentInvestigation = {
      id: "investigation-1",
      status: "waiting_for_approval" as const,
      cwd: "/workspace/podo",
      sandbox: "read-only" as const,
      createdAt: "2026-07-14T09:00:00.000Z",
      updatedAt: "2026-07-14T09:01:00.000Z",
      lastSequence: 4,
      pendingApproval: {
        id: "approval-1",
        kind: "command" as const,
        status: "pending" as const,
        command: "cat production-secrets",
        reason: "sensitive internal detail",
      },
    }
    const system = {
      service: "podo-core" as const,
      status: "ready" as const,
      version: "0.0.0",
      codex: { available: true, binary: "codex", transport: "stdio" as const, version: "0.144.1" },
      remediation: { configured: false },
    }

    expect(selectIncident([linkedIncident, newerUnlinkedIncident])?.id).toBe("incident-linked")

    const viewModel = toTuiViewModel(
      system,
      settings,
      [linkedIncident, newerUnlinkedIncident],
      currentInvestigation,
    )

    expect(viewModel.status).toBe("waiting_for_approval")
    expect(viewModel.pendingApproval).toEqual({
      id: "approval-1",
      summary: "Core requests explicit approval for command.",
    })
    expect(JSON.stringify(viewModel)).not.toContain("production-secrets")
    expect(JSON.stringify(viewModel)).not.toContain("sensitive internal detail")
  })

  test("turns an output delta into a fixed activity label", () => {
    const activity = toTuiActivity({
      investigationId: "investigation-1",
      sequence: 9,
      timestamp: "2026-07-14T09:09:00.000Z",
      kind: "output.delta",
      payload: { text: "untrusted raw model output" },
    })

    expect(activity).toEqual({
      sequence: 9,
      occurredAt: "2026-07-14T09:09:00.000Z",
      label: "Agent output received",
    })
    expect(JSON.stringify(activity)).not.toContain("untrusted raw model output")
  })

  test("keeps a newer SSE approval when a delayed approval response has an older sequence", () => {
    const current = {
      id: "investigation-1",
      status: "waiting_for_approval" as const,
      cwd: "/workspace/podo",
      sandbox: "read-only" as const,
      createdAt: "2026-07-14T09:00:00.000Z",
      updatedAt: "2026-07-14T09:05:00.000Z",
      lastSequence: 5,
      pendingApproval: { id: "approval-2", kind: "command" as const, status: "pending" as const },
    }
    const delayedResponse = {
      ...current,
      status: "running" as const,
      lastSequence: 4,
      pendingApproval: null,
    }

    expect(shouldReplaceInvestigation(current, delayedResponse)).toBe(false)
    expect(current.pendingApproval?.id).toBe("approval-2")
  })

  test("only lets a terminal cancel response abort its matching active stream", () => {
    expect(shouldAbortActiveStream("investigation-new", "investigation-old")).toBe(false)
    expect(shouldAbortActiveStream("investigation-current", "investigation-current")).toBe(true)
  })
})
