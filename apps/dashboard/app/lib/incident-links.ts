import type { AuditEvent } from "./audit-types"
import type { IncidentTab } from "./incident-types"

export function incidentWorkspaceHref({
  eventId,
  incidentId,
  nodeId,
  tab,
}: {
  eventId?: string
  incidentId: string
  nodeId?: string
  tab: IncidentTab
}) {
  const params = new URLSearchParams({ incident: incidentId, tab })
  if (eventId) params.set("event", eventId)
  if (nodeId) params.set("node", nodeId)
  return `/?${params.toString()}#workspace`
}

export function auditEventIncidentTab(event: AuditEvent): IncidentTab {
  if (
    event.category === "Delivery" ||
    event.category === "Remediation" ||
    event.category === "Approval" ||
    event.action === "tool.run_tests"
  )
    return "changes"

  if (
    event.category === "Investigation" ||
    event.action === "evidence.correlate"
  )
    return "graph"

  return "evidence"
}
