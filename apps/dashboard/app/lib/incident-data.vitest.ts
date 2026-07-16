import type { PodoClient, PodoIncidentClient } from "@podo/client"
import type { DetectedIncident } from "@podo/contracts"
import { describe, expect, it, vi } from "vitest"

import { getIncidentCausalPath, getIncidentWorkspace } from "./incident-data"

function incident(id: string, updatedAt: string): DetectedIncident {
  return {
    id,
    status: "detected",
    detector: "cache_growth",
    affectedService: "checkout-service",
    deploymentId: "deploy-1042",
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt,
    evidence: [],
  }
}

describe("getIncidentWorkspace", () => {
  it("loads an explicitly selected incident through the typed client", async () => {
    const selected = incident("incident_selected", "2026-07-14T10:10:00.000Z")
    const client = {
      getIncident: vi.fn(async () => ({ incident: selected })),
      listIncidents: vi.fn(),
    } as unknown as PodoClient

    await expect(
      getIncidentWorkspace({ client, incidentId: selected.id }),
    ).resolves.toEqual(selected)
    expect(client.getIncident).toHaveBeenCalledWith(selected.id)
    expect(client.listIncidents).not.toHaveBeenCalled()
  })

  it("selects the most recently updated incident without mutating the response", async () => {
    const older = incident("incident_older", "2026-07-14T10:10:00.000Z")
    const newest = incident("incident_newest", "2026-07-14T10:20:00.000Z")
    const incidents = [newest, older]
    const client = {
      listIncidents: vi.fn(async () => ({ incidents })),
    } as unknown as PodoClient

    await expect(getIncidentWorkspace({ client })).resolves.toEqual(newest)
    expect(incidents).toEqual([newest, older])
  })

  it("returns null when core has no detected incidents", async () => {
    const client = {
      listIncidents: vi.fn(async () => ({ incidents: [] })),
    } as unknown as PodoClient

    await expect(getIncidentWorkspace({ client })).resolves.toBeNull()
  })
})

describe("getIncidentCausalPath", () => {
  it("uses actual incident evidence to request the Core-owned path", async () => {
    const selected = {
      ...incident("incident_selected", "2026-07-14T10:10:00.000Z"),
      evidence: [
        {
          id: "evidence-1",
          sourceEventId: "event-1",
          sourceType: "metric" as const,
          observedAt: "2026-07-14T10:09:00.000Z",
          service: "checkout-service",
          deploymentId: "deploy-1042",
        },
      ],
    }
    const causalPath = {
      schemaVersion: "podo.causal-path.v1" as const,
      id: "path-1",
      incident: { id: selected.id },
      evidence: { id: "evidence-1" },
      telemetryEvent: { id: "event-1", occurredAt: selected.updatedAt },
      container: { id: "checkout-service-7b9c" },
      deployment: { id: "deploy-1042" },
      commit: { id: "commit-1", sha: "d34db33f" },
      file: {
        id: "file-1",
        kind: "file" as const,
        externalId: "file:cache",
        label: "cache.ts",
      },
      function: {
        id: "function-1",
        kind: "function" as const,
        externalId: "function:cache",
        label: "CheckoutCache",
      },
    }
    const client = {
      getIncidentCausalPath: vi.fn(async () => ({ causalPath })),
    } as unknown as PodoIncidentClient

    await expect(getIncidentCausalPath(selected, client)).resolves.toEqual(
      causalPath,
    )
    expect(client.getIncidentCausalPath).toHaveBeenCalledWith(
      selected.id,
      "evidence-1",
    )
  })
})
