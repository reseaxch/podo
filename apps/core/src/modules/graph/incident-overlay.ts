import type { DetectedIncident, IncidentEvidence } from "@podo/contracts"

import type { TelemetryEvent } from "../telemetry"
import type { OperationalGraphLink, OperationalGraphNode, OperationalGraphOverlay } from "./in-memory-graph"

export interface TrustedDeploymentCorrelation {
  deploymentId: string
  containerId: string
  commitSha: string
  changedFileNodeId: string
}

export type IncidentOverlayIssueCode =
  | "missing_provenance"
  | "mismatched_provenance"
  | "ambiguous_evidence"
  | "invalid_identity"

export interface IncidentOverlayIssue {
  code: IncidentOverlayIssueCode
  path: string
  message: string
}

export type ConstructIncidentOperationalOverlayResult =
  | { ok: true; overlay: OperationalGraphOverlay }
  | {
      ok: false
      rejection: {
        code: "PODO_OPERATIONAL_OVERLAY_REJECTED"
        issues: IncidentOverlayIssue[]
      }
    }

export function constructIncidentOperationalOverlay(input: {
  incident: DetectedIncident
  evidenceEvents: readonly TelemetryEvent[]
  correlation: TrustedDeploymentCorrelation
}): ConstructIncidentOperationalOverlayResult {
  const { incident, evidenceEvents, correlation } = input
  const issues: IncidentOverlayIssue[] = []

  requireIdentity(incident.id, "incident.id", issues)
  requireProvenance(incident.deploymentId, "incident.deploymentId", issues)
  requireIdentity(incident.affectedService, "incident.affectedService", issues)
  requireProvenance(correlation.deploymentId, "correlation.deploymentId", issues)
  requireProvenance(correlation.containerId, "correlation.containerId", issues)
  requireProvenance(correlation.commitSha, "correlation.commitSha", issues)
  requireProvenance(correlation.changedFileNodeId, "correlation.changedFileNodeId", issues)

  if (isIdentity(incident.deploymentId)
    && isIdentity(correlation.deploymentId)
    && incident.deploymentId !== correlation.deploymentId) {
    addIssue(
      issues,
      "mismatched_provenance",
      "correlation.deploymentId",
      `Trusted deployment "${correlation.deploymentId}" does not match incident deployment "${incident.deploymentId}"`,
    )
  }

  if (incident.evidence.length === 0) {
    addIssue(issues, "missing_provenance", "incident.evidence", "Incident must contain at least one evidence reference")
  }

  const evidenceIdCounts = countValues(incident.evidence.map(({ id }) => id))
  for (const [id, count] of evidenceIdCounts) {
    if (count > 1) {
      addIssue(issues, "ambiguous_evidence", `incident.evidence[id=${id}]`, `Evidence ID "${id}" appears ${count} times`)
    }
  }
  const sourceReferenceCounts = countValues(incident.evidence.map(({ sourceEventId }) => sourceEventId))
  for (const [sourceEventId, count] of sourceReferenceCounts) {
    if (count > 1) {
      addIssue(
        issues,
        "ambiguous_evidence",
        `incident.evidence[sourceEventId=${sourceEventId}]`,
        `Telemetry event "${sourceEventId}" is referenced by ${count} evidence records`,
      )
    }
  }

  const eventsById = new Map<string, TelemetryEvent[]>()
  for (const event of evidenceEvents) {
    if (!isIdentity(event.id)) {
      addIssue(issues, "invalid_identity", "evidenceEvents[].id", "Telemetry event ID must be non-empty normalized text")
      continue
    }
    const matches = eventsById.get(event.id) ?? []
    matches.push(event)
    eventsById.set(event.id, matches)
  }
  for (const [id, matches] of eventsById) {
    if (matches.length > 1) {
      addIssue(issues, "ambiguous_evidence", `evidenceEvents[id=${id}]`, `Telemetry event ID "${id}" appears ${matches.length} times`)
    }
    if (!sourceReferenceCounts.has(id)) {
      addIssue(issues, "ambiguous_evidence", `evidenceEvents[id=${id}]`, `Telemetry event "${id}" is not referenced by the incident`)
    }
  }

  const orderedEvidence = [...incident.evidence].sort((left, right) => compareStrings(left.id, right.id))
  const resolved: Array<{ evidence: IncidentEvidence; event: TelemetryEvent }> = []
  for (const evidence of orderedEvidence) {
    requireIdentity(evidence.id, `incident.evidence[id=${evidence.id}].id`, issues)
    requireIdentity(evidence.sourceEventId, `incident.evidence[id=${evidence.id}].sourceEventId`, issues)
    const matches = eventsById.get(evidence.sourceEventId) ?? []
    if (matches.length === 0) {
      addIssue(
        issues,
        "missing_provenance",
        `incident.evidence[id=${evidence.id}].sourceEventId`,
        `Referenced telemetry event "${evidence.sourceEventId}" is missing`,
      )
      continue
    }
    if (matches.length !== 1) continue
    const event = matches[0]!
    resolved.push({ evidence, event })
    validateEvidenceProvenance(incident, evidence, event, correlation, issues)
  }

  validateOperationalIdentities(incident, resolved, correlation, issues)
  if (issues.length > 0) return rejected(issues)

  const nodes: OperationalGraphNode[] = [
    { id: incident.id, kind: "incident" },
    { id: correlation.containerId, kind: "container" },
    { id: correlation.deploymentId, kind: "deployment" },
    { id: correlation.commitSha, kind: "commit", sha: correlation.commitSha },
  ]
  const links: OperationalGraphLink[] = [
    { type: "RUNS", fromNodeId: correlation.containerId, toNodeId: correlation.deploymentId },
    { type: "USES", fromNodeId: correlation.deploymentId, toNodeId: correlation.commitSha },
    { type: "CHANGED", fromNodeId: correlation.commitSha, toNodeId: correlation.changedFileNodeId },
  ]

  for (const { evidence, event } of resolved) {
    nodes.push(
      { id: evidence.id, kind: "evidence" },
      { id: event.id, kind: "telemetry_event", occurredAt: event.timestamp },
    )
    links.push(
      { type: "SUPPORTED_BY", fromNodeId: incident.id, toNodeId: evidence.id },
      { type: "DERIVED_FROM", fromNodeId: evidence.id, toNodeId: event.id },
      { type: "OBSERVED_IN", fromNodeId: event.id, toNodeId: correlation.containerId },
    )
  }

  nodes.sort((left, right) => compareStrings(left.id, right.id))
  links.sort((left, right) => compareStrings(linkKey(left), linkKey(right)))
  return { ok: true, overlay: { nodes, links } }
}

function validateEvidenceProvenance(
  incident: DetectedIncident,
  evidence: IncidentEvidence,
  event: TelemetryEvent,
  correlation: TrustedDeploymentCorrelation,
  issues: IncidentOverlayIssue[],
): void {
  const eventPath = `evidenceEvents[id=${event.id}]`
  compareProvenance(evidence.sourceType, event.kind, `${eventPath}.kind`, "evidence source type", issues)
  compareProvenance(evidence.observedAt, event.timestamp, `${eventPath}.timestamp`, "evidence timestamp", issues)
  compareProvenance(evidence.service, incident.affectedService, `incident.evidence[id=${evidence.id}].service`, "incident service", issues)
  compareProvenance(event.service, incident.affectedService, `${eventPath}.service`, "incident service", issues)
  compareProvenance(evidence.deploymentId, incident.deploymentId, `incident.evidence[id=${evidence.id}].deploymentId`, "incident deployment", issues)

  if (!isIdentity(event.deploymentId)) {
    addIssue(issues, "missing_provenance", `${eventPath}.deploymentId`, "Telemetry evidence must identify its deployment")
  } else {
    compareProvenance(event.deploymentId, correlation.deploymentId, `${eventPath}.deploymentId`, "trusted deployment", issues)
  }
  if (!isIdentity(event.containerId)) {
    addIssue(issues, "missing_provenance", `${eventPath}.containerId`, "Telemetry evidence must identify its container")
  } else {
    compareProvenance(event.containerId, correlation.containerId, `${eventPath}.containerId`, "trusted container", issues)
  }
  if (event.commitId !== undefined) {
    if (!isIdentity(event.commitId)) {
      addIssue(issues, "missing_provenance", `${eventPath}.commitId`, "Present telemetry commit ID must be non-empty normalized text")
    } else {
      compareProvenance(event.commitId, correlation.commitSha, `${eventPath}.commitId`, "trusted commit", issues)
    }
  }
}

function validateOperationalIdentities(
  incident: DetectedIncident,
  resolved: readonly { evidence: IncidentEvidence; event: TelemetryEvent }[],
  correlation: TrustedDeploymentCorrelation,
  issues: IncidentOverlayIssue[],
): void {
  const operationalIds = [
    incident.id,
    correlation.containerId,
    correlation.deploymentId,
    correlation.commitSha,
    ...resolved.flatMap(({ evidence, event }) => [evidence.id, event.id]),
  ]
  for (const [id, count] of countValues(operationalIds)) {
    if (isIdentity(id) && count > 1) {
      addIssue(issues, "invalid_identity", `operationalNodes[id=${id}]`, `Operational node ID "${id}" is not unique`)
    }
  }
  if (operationalIds.includes(correlation.changedFileNodeId)) {
    addIssue(
      issues,
      "invalid_identity",
      "correlation.changedFileNodeId",
      "Changed file node ID collides with an operational node identity",
    )
  }
}

function compareProvenance(
  actual: string,
  expected: string,
  path: string,
  expectedLabel: string,
  issues: IncidentOverlayIssue[],
): void {
  if (actual !== expected) {
    addIssue(issues, "mismatched_provenance", path, `Value "${actual}" does not match ${expectedLabel} "${expected}"`)
  }
}

function requireIdentity(value: unknown, path: string, issues: IncidentOverlayIssue[]): void {
  if (!isIdentity(value)) addIssue(issues, "invalid_identity", path, "Identity must be non-empty normalized text")
}

function requireProvenance(value: unknown, path: string, issues: IncidentOverlayIssue[]): void {
  if (!isIdentity(value)) addIssue(issues, "missing_provenance", path, "Trusted provenance must be non-empty normalized text")
}

function rejected(issues: IncidentOverlayIssue[]): ConstructIncidentOperationalOverlayResult {
  return {
    ok: false,
    rejection: {
      code: "PODO_OPERATIONAL_OVERLAY_REJECTED",
      issues: issues.sort((left, right) => compareStrings(issueKey(left), issueKey(right))),
    },
  }
}

function addIssue(
  issues: IncidentOverlayIssue[],
  code: IncidentOverlayIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message })
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return new Map([...counts.entries()].sort(([left], [right]) => compareStrings(left, right)))
}

function issueKey(issue: IncidentOverlayIssue): string {
  return `${issue.path}\u0000${issue.code}\u0000${issue.message}`
}

function linkKey(link: OperationalGraphLink): string {
  return `${link.type}\u0000${link.fromNodeId}\u0000${link.toNodeId}`
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
}
