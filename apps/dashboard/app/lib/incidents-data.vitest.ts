import type { createPodoClient } from "@podo/client"
import type { DetectedIncident } from "@podo/contracts"
import { describe, expect, it, vi } from "vitest"

import { getIncidentOverview } from "./incidents-data"

describe("getIncidentOverview", () => {
  it("maps authoritative Core fields without inventing severity, ownership, or a detector-specific title", async () => {
    const incident: DetectedIncident = {
      id: "incident-42",
      status: "detected",
      detector: "cache_growth",
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
      createdAt: "2026-07-15T19:00:00.000Z",
      updatedAt: "2026-07-15T20:00:00.000Z",
      evidence: [
        {
          id: "evidence-1",
          sourceEventId: "event-1",
          sourceType: "metric",
          observedAt: "2026-07-15T19:59:00.000Z",
          service: "checkout-service",
          deploymentId: "deploy-1042",
        },
      ],
      investigation: {
        id: "investigation-1",
        status: "waiting_for_approval",
        startedAt: "2026-07-15T19:30:00.000Z",
        updatedAt: "2026-07-15T20:00:00.000Z",
      },
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "Unbounded checkout cache",
        affectedService: "checkout-service",
        probableRootCause: "Cache entries are retained indefinitely",
        confidence: { value: 8765, scale: "basis_points" },
        evidenceIds: ["evidence-1"],
        recommendedAction: "Bound the cache",
        safeToAttemptFix: true,
      },
    }
    const listIncidents = vi.fn().mockResolvedValue({ incidents: [incident] })
    const missing = vi.fn().mockRejectedValue(new Error("Not found (404)"))
    const client = {
      listIncidents,
      getIncidentRemediation: missing,
      getIncidentDelivery: missing,
    } as unknown as ReturnType<typeof createPodoClient>

    const overview = await getIncidentOverview({ client })

    expect(listIncidents).toHaveBeenCalledOnce()
    expect(overview).toMatchObject({
      owner: { name: "Podo Core", avatar: "/icon.svg" },
      generatedAt: "Updated from Core",
      incidents: [
        {
          id: "incident-42",
          title: "checkout-service cache growth incident",
          severity: "Unclassified",
          status: "Awaiting approval",
          service: "checkout-service",
          diagnosis: "Cache entries are retained indefinitely",
          confidence: 87.65,
          evidenceCount: 1,
          owner: { name: "Unassigned", initials: "—" },
          hasWorkspace: true,
          attentionReason: "Needs approval",
        },
      ],
    })
  })
})
