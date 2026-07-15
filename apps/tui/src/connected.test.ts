import { describe, expect, test } from "bun:test"

import { toPodoSettings, toTuiSettings, toTuiViewModel } from "./connected"

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
})
