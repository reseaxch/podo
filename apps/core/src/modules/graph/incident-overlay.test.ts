import { describe, expect, test } from "bun:test"
import { PODO_CODE_GRAPH_SCHEMA_VERSION, type NormalizedCodeGraphSnapshot, type TelemetryEventInput } from "@podo/contracts"

import { IncidentMonitor } from "../incidents/incident-monitor"
import type { TelemetryEvent } from "../telemetry"
import {
  constructIncidentOperationalOverlay,
  type TrustedDeploymentCorrelation,
} from "./incident-overlay"
import { InMemoryPodoGraph } from "./in-memory-graph"

const correlation: TrustedDeploymentCorrelation = {
  deploymentId: "deploy-1042",
  containerId: "checkout-service-7b9c",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  changedFileNodeId: "code:file:checkout-cache",
}

async function canonicalCacheGrowth() {
  const fixtureUrl = new URL("../../../../../scenarios/cache-growth/fixtures/telemetry.json", import.meta.url)
  const fixture = await Bun.file(fixtureUrl).json() as TelemetryEventInput[]
  const monitor = new IncidentMonitor()
  const detected = monitor.ingest(fixture)
  expect(detected.incident).not.toBeNull()
  const incident = detected.incident!
  const events = monitor.getEvidenceEvents(incident.id)
  expect(events).not.toBeNull()
  return { incident, events: events! }
}

describe("constructIncidentOperationalOverlay", () => {
  test("constructs the canonical cache-growth overlay with real identities and required graph kinds", async () => {
    const { incident, events } = await canonicalCacheGrowth()

    const result = constructIncidentOperationalOverlay({ incident, evidenceEvents: events, correlation })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { nodes, links } = result.overlay
    expect(nodes).toHaveLength(4 + incident.evidence.length * 2)
    expect(links).toHaveLength(3 + incident.evidence.length * 3)
    expect(new Set(nodes.map(({ kind }) => kind))).toEqual(new Set([
      "commit",
      "deployment",
      "container",
      "telemetry_event",
      "incident",
      "evidence",
    ]))
    expect(new Set(links.map(({ type }) => type))).toEqual(new Set([
      "SUPPORTED_BY",
      "DERIVED_FROM",
      "OBSERVED_IN",
      "RUNS",
      "USES",
      "CHANGED",
    ]))
    expect(nodes).toContainEqual({ id: incident.id, kind: "incident" })
    expect(nodes).toContainEqual({ id: correlation.deploymentId, kind: "deployment" })
    expect(nodes).toContainEqual({ id: correlation.containerId, kind: "container" })
    expect(nodes).toContainEqual({ id: correlation.commitSha, kind: "commit", sha: correlation.commitSha })
    expect(nodes).toContainEqual({ id: events[0]!.id, kind: "telemetry_event", occurredAt: events[0]!.timestamp })
    expect(nodes).toContainEqual({ id: incident.evidence[0]!.id, kind: "evidence" })
    expect(links).toContainEqual({ type: "CHANGED", fromNodeId: correlation.commitSha, toNodeId: correlation.changedFileNodeId })

    const graph = new InMemoryPodoGraph()
    expect(graph.load({ codeGraph: codeGraphForChangedFile(), operationalOverlay: result.overlay }).ok).toBe(true)
    expect(graph.resolveCausalPath({
      incidentId: incident.id,
      evidenceId: incident.evidence[0]!.id,
    })).toMatchObject({
      ok: true,
      path: {
        telemetryEventNodeId: incident.evidence[0]!.sourceEventId,
        deploymentNodeId: correlation.deploymentId,
        commitNodeId: correlation.commitSha,
        fileNodeId: correlation.changedFileNodeId,
      },
    })
  })

  test("is deterministic when incident evidence and normalized events are reordered", async () => {
    const { incident, events } = await canonicalCacheGrowth()

    const first = constructIncidentOperationalOverlay({ incident, evidenceEvents: events, correlation })
    const reordered = constructIncidentOperationalOverlay({
      incident: { ...incident, evidence: [...incident.evidence].reverse() },
      evidenceEvents: [...events].reverse(),
      correlation,
    })

    expect(reordered).toEqual(first)
  })

  test("rejects missing and mismatched deployment, container, and commit provenance", async () => {
    const { incident, events } = await canonicalCacheGrowth()
    const firstEvent = events[0]!
    const controls: Array<{
      correlation?: TrustedDeploymentCorrelation
      events?: TelemetryEvent[]
      code: string
      path: string
    }> = [
      {
        correlation: { ...correlation, commitSha: "" },
        code: "missing_provenance",
        path: "correlation.commitSha",
      },
      {
        correlation: { ...correlation, deploymentId: "deploy-other" },
        code: "mismatched_provenance",
        path: "correlation.deploymentId",
      },
      {
        events: events.map((event, index) => index === 0 ? withoutContainer(event) : event),
        code: "missing_provenance",
        path: `evidenceEvents[id=${firstEvent.id}].containerId`,
      },
      {
        events: events.map((event, index) => index === 0 ? { ...event, containerId: "container-other" } : event),
        code: "mismatched_provenance",
        path: `evidenceEvents[id=${firstEvent.id}].containerId`,
      },
      {
        events: events.map((event, index) => index === 0 ? { ...event, commitId: "ffffffffffffffffffffffffffffffffffffffff" } : event),
        code: "mismatched_provenance",
        path: `evidenceEvents[id=${firstEvent.id}].commitId`,
      },
    ]

    for (const control of controls) {
      const result = constructIncidentOperationalOverlay({
        incident,
        evidenceEvents: control.events ?? events,
        correlation: control.correlation ?? correlation,
      })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.rejection.issues).toContainEqual(expect.objectContaining({
        code: control.code,
        path: control.path,
      }))
    }
  })

  test("rejects missing, duplicated, and ambiguously referenced evidence", async () => {
    const { incident, events } = await canonicalCacheGrowth()
    const firstEvidence = incident.evidence[0]!
    const firstEvent = events[0]!

    const missing = constructIncidentOperationalOverlay({
      incident,
      evidenceEvents: events.slice(1),
      correlation,
    })
    expect(missing).toMatchObject({
      ok: false,
      rejection: {
        issues: expect.arrayContaining([
          { code: "missing_provenance", path: `incident.evidence[id=${firstEvidence.id}].sourceEventId`, message: expect.any(String) },
        ]),
      },
    })

    const duplicateEvent = constructIncidentOperationalOverlay({
      incident,
      evidenceEvents: [...events, structuredClone(firstEvent)],
      correlation,
    })
    expect(duplicateEvent).toMatchObject({
      ok: false,
      rejection: {
        issues: expect.arrayContaining([
          { code: "ambiguous_evidence", path: `evidenceEvents[id=${firstEvent.id}]`, message: expect.any(String) },
        ]),
      },
    })

    const duplicateReference = constructIncidentOperationalOverlay({
      incident: {
        ...incident,
        evidence: [...incident.evidence, { ...firstEvidence, id: `${firstEvidence.id}-duplicate` }],
      },
      evidenceEvents: events,
      correlation,
    })
    expect(duplicateReference).toMatchObject({
      ok: false,
      rejection: {
        issues: expect.arrayContaining([
          { code: "ambiguous_evidence", path: `incident.evidence[sourceEventId=${firstEvent.id}]`, message: expect.any(String) },
        ]),
      },
    })
  })

  test("never derives the changed file from untrusted telemetry fields", async () => {
    const { incident, events } = await canonicalCacheGrowth()
    const poisoned = events.map((event) => ({
      ...event,
      changedFileNodeId: "code:file:attacker-selected",
    })) as TelemetryEvent[]

    const result = constructIncidentOperationalOverlay({ incident, evidenceEvents: poisoned, correlation })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.overlay.links.filter(({ type }) => type === "CHANGED")).toEqual([
      { type: "CHANGED", fromNodeId: correlation.commitSha, toNodeId: correlation.changedFileNodeId },
    ])
    expect(JSON.stringify(result.overlay)).not.toContain("attacker-selected")
  })
})

function codeGraphForChangedFile(): NormalizedCodeGraphSnapshot {
  return {
    id: "graph-cache-growth-test",
    schemaVersion: PODO_CODE_GRAPH_SCHEMA_VERSION,
    source: { provider: "test", graphId: "cache-growth", schemaVersion: "1" },
    nodes: [
      {
        id: correlation.changedFileNodeId,
        externalId: "external:checkout-cache-file",
        kind: "file",
        label: "cache.ts",
        provenance: "extracted",
      },
      {
        id: "code:function:checkout-cache-set",
        externalId: "external:checkout-cache-set",
        kind: "function",
        label: "CheckoutCache.set",
        provenance: "extracted",
      },
    ],
    links: [
      {
        id: "code:link:file-function",
        externalId: "external:file-function",
        type: "CONTAINS",
        fromNodeId: correlation.changedFileNodeId,
        toNodeId: "code:function:checkout-cache-set",
        fromExternalId: "external:checkout-cache-file",
        toExternalId: "external:checkout-cache-set",
        provenance: "extracted",
      },
    ],
  }
}

function withoutContainer(event: TelemetryEvent): TelemetryEvent {
  const { containerId: _containerId, ...withoutContainerId } = event
  return withoutContainerId
}
