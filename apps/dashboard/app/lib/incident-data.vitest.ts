import type { PodoClient } from "@podo/client"
import type { DetectedIncident } from "@podo/contracts"
import { describe, expect, it, vi } from "vitest"

import { getIncidentWorkspace } from "./incident-data"

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
