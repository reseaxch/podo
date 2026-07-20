import type { PodoClient, PodoIncidentClient } from "@podo/client"
import type { DetectedIncident, IncidentEvidenceRecord } from "@podo/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  getIncidentCausalPath,
  getIncidentWorkspace,
  toCoreIncidentWorkspace,
} from "./incident-data"

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

describe("toCoreIncidentWorkspace", () => {
  it("shows representative cited signals and compact graph labels", () => {
    const cited = [
      ["evidence_metric_start", "metric", "process heap sample", 222],
      ["evidence_metric_middle", "metric", "process heap sample", 402],
      ["evidence_metric_end", "metric", "process heap sample", 642],
      ["evidence_trace", "trace", "checkout request failed", 0],
      ["evidence_log", "log", "garbage collection pressure", 0],
    ] as const
    const selected: DetectedIncident = {
      ...incident("incident_diagnosed", "2026-07-14T10:15:00.000Z"),
      evidence: cited.map(([id, kind], index) => ({
        id,
        sourceEventId: `event-${index}`,
        sourceType: kind,
        observedAt: `2026-07-14T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
        service: "checkout-service",
        deploymentId: "deploy-1042",
      })),
      investigation: {
        id: "investigation-diagnosed",
        status: "completed",
        startedAt: "2026-07-14T10:01:00.000Z",
        updatedAt: "2026-07-14T10:10:00.000Z",
      },
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "Heap growth correlates with checkout failures",
        affectedService: "checkout-service",
        probableRootCause: "Checkout cache retains heap",
        confidence: { value: 8750, scale: "basis_points" },
        evidenceIds: cited.map(([id]) => id),
        recommendedAction: "Bound the cache",
        safeToAttemptFix: true,
      },
    }
    const records: IncidentEvidenceRecord[] = cited.map(
      ([, kind, message, mebibytes], index) => ({
        evidence: selected.evidence[index]!,
        event: {
          id: `event-${index}`,
          timestamp: `2026-07-14T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
          kind,
          service: "checkout-service",
          severity: kind === "metric" ? "warn" : "error",
          message,
          deploymentId: "deploy-1042",
          ...(kind === "metric"
            ? {
                metric: {
                  name: "process.heap.used",
                  value: mebibytes * 1024 * 1024,
                  unit: "By",
                },
              }
            : {}),
          ...(kind === "trace" ? { traceId: "trace-live" } : {}),
        },
      }),
    )

    const workspace = toCoreIncidentWorkspace({
      incident: selected,
      records,
      causalPath: {
        schemaVersion: "podo.causal-path.v1",
        id: "path-diagnosed",
        incident: { id: selected.id },
        evidence: { id: "evidence_metric_start" },
        telemetryEvent: {
          id: "event-0",
          occurredAt: "2026-07-14T10:01:00.000Z",
        },
        container: { id: "checkout-service-7b9c" },
        deployment: { id: "deploy-1042" },
        commit: { id: "commit-diagnosed", sha: "d34db33f" },
        file: {
          id: "file-diagnosed",
          kind: "file",
          externalId: "file:cache",
          label: "cache.ts",
          location: {
            path: "demo/services/checkout-service/src/cache.ts",
            line: 1,
          },
        },
        function: {
          id: "function-diagnosed",
          kind: "function",
          externalId: "function:cache",
          label: "CheckoutCache",
          location: {
            path: "demo/services/checkout-service/src/cache.ts",
            line: 15,
          },
        },
      },
      remediation: null,
      delivery: null,
      issueDelivery: null,
    })

    expect(workspace.diagnosis?.supportingEvidence).toHaveLength(4)
    expect(workspace.diagnosis?.supportingEvidence.map(({ id }) => id)).toEqual(
      [
        "evidence_metric_start",
        "evidence_metric_end",
        "evidence_trace",
        "evidence_log",
      ],
    )
    expect(workspace.diagnosis?.supportingEvidenceLabel).toBe(
      "Representative cited signals",
    )
    expect(workspace.graph?.nodes[1]).toMatchObject({
      title: "Heap 642 MiB",
      subtitle: "Jul 14 · 10:03 AM UTC",
    })
    expect(workspace.graph?.nodes[4]?.subtitle).toBe("cache.ts")
  })
})
