import {
  PODO_CAUSAL_PATH_SCHEMA_VERSION,
  type GetIncidentCausalPathResponse,
  type NormalizedCodeGraphSnapshot,
} from "@podo/contracts"

import type { IncidentMonitor } from "../incidents/incident-monitor"
import { InMemoryPodoGraph } from "./in-memory-graph"
import {
  constructIncidentOperationalOverlay,
  type TrustedDeploymentCorrelation,
} from "./incident-overlay"

export interface IncidentGraphConfig {
  codeGraph: NormalizedCodeGraphSnapshot
  trustedCorrelations: readonly TrustedDeploymentCorrelation[]
}

export type IncidentCausalPathErrorCode =
  | "incident_not_found"
  | "evidence_not_found"
  | "causal_path_unavailable"
  | "causal_path_unresolved"

export type ResolveIncidentCausalPathResult =
  | { ok: true; response: GetIncidentCausalPathResponse }
  | {
      ok: false
      status: 404 | 409 | 503
      error: IncidentCausalPathErrorCode
      message: string
    }

export class IncidentCausalPathService {
  private readonly config: IncidentGraphConfig | undefined

  constructor(
    private readonly incidents: IncidentMonitor,
    config?: IncidentGraphConfig,
  ) {
    this.config = config ? structuredClone(config) : undefined
  }

  resolve(incidentId: string, evidenceId: string): ResolveIncidentCausalPathResult {
    const incident = this.incidents.getIncident(incidentId)
    if (!incident) return failure(404, "incident_not_found", "Incident was not found")

    const evidence = incident.evidence.find((candidate) => candidate.id === evidenceId)
    if (!evidence) return failure(404, "evidence_not_found", "Evidence was not found on this incident")
    if (!this.config) return failure(503, "causal_path_unavailable", "A normalized code graph has not been configured")

    const correlations = this.config.trustedCorrelations.filter(({ deploymentId }) => deploymentId === incident.deploymentId)
    if (correlations.length !== 1) {
      return failure(
        409,
        "causal_path_unresolved",
        correlations.length === 0
          ? "Trusted deployment correlation is missing"
          : "Trusted deployment correlation is ambiguous",
      )
    }
    const correlation = correlations[0]!
    const evidenceEvents = this.incidents.getEvidenceEvents(incident.id)
    if (!evidenceEvents) return failure(409, "causal_path_unresolved", "Incident evidence provenance is unavailable")

    const constructed = constructIncidentOperationalOverlay({ incident, evidenceEvents, correlation })
    if (!constructed.ok) return failure(409, "causal_path_unresolved", "Operational evidence provenance is invalid")

    const graph = new InMemoryPodoGraph()
    const loaded = graph.load({ codeGraph: this.config.codeGraph, operationalOverlay: constructed.overlay })
    if (!loaded.ok) return failure(409, "causal_path_unresolved", "The causal graph is missing or ambiguous")

    const resolved = graph.resolveCausalPath({ incidentId, evidenceId })
    if (!resolved.ok) return failure(409, "causal_path_unresolved", "The requested causal path is missing or ambiguous")

    const event = evidenceEvents.find(({ id }) => id === evidence.sourceEventId)
    if (!event) return failure(409, "causal_path_unresolved", "The resolved evidence event is unavailable")
    const path = resolved.path
    const file = graph.getCodeNode(path.fileNodeId)
    const fn = graph.getCodeNode(path.functionNodeId)
    if (!file || file.kind !== "file" || !fn || fn.kind !== "function") {
      return failure(409, "causal_path_unresolved", "Resolved code nodes are missing or have incompatible kinds")
    }
    return {
      ok: true,
      response: {
        causalPath: {
          schemaVersion: PODO_CAUSAL_PATH_SCHEMA_VERSION,
          id: path.id,
          incident: { id: path.incidentNodeId },
          evidence: { id: path.evidenceNodeId },
          telemetryEvent: { id: path.telemetryEventNodeId, occurredAt: event.timestamp },
          container: { id: path.containerNodeId },
          deployment: { id: path.deploymentNodeId },
          commit: { id: path.commitNodeId, sha: correlation.commitSha },
          file: {
            id: file.id,
            kind: "file",
            externalId: file.externalId,
            label: file.label,
            ...(file.location ? { location: structuredClone(file.location) } : {}),
          },
          function: {
            id: fn.id,
            kind: "function",
            externalId: fn.externalId,
            label: fn.label,
            ...(fn.location ? { location: structuredClone(fn.location) } : {}),
          },
        },
      },
    }
  }
}

function failure(
  status: 404 | 409 | 503,
  error: IncidentCausalPathErrorCode,
  message: string,
): ResolveIncidentCausalPathResult {
  return { ok: false, status, error, message }
}
