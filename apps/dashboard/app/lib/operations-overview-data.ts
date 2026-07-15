import { operationsOverviewMock } from "../mocks/operations-overview"
import { createDashboardClient, isDemoDashboard } from "./dashboard-client"
import { getIncidentOverview } from "./incidents-data"
import type { OperationsOverviewViewModel } from "./operations-overview-types"

export async function getOperationsOverview(): Promise<OperationsOverviewViewModel> {
  if (isDemoDashboard()) return structuredClone(operationsOverviewMock)

  const client = createDashboardClient()
  const [incidentOverview, system] = await Promise.all([
    getIncidentOverview(),
    client.systemStatus(),
  ])
  const evidenceCount = incidentOverview.incidents.reduce(
    (total, incident) => total + incident.evidenceCount,
    0,
  )

  return {
    owner: incidentOverview.owner,
    generatedAt: "Updated from Core",
    incidents: incidentOverview.incidents,
    signals: [
      {
        label: "Core runtime",
        value: system.status === "ready" ? "Ready" : "Degraded",
        detail: system.codex.available
          ? `Codex ${system.codex.version ?? "connected"}`
          : (system.codex.error ?? "Codex unavailable"),
        tone: system.status === "ready" ? "healthy" : "critical",
        href: "/settings",
      },
      {
        label: "Evidence pipeline",
        value: `${evidenceCount} records`,
        detail: `${incidentOverview.incidents.length} detected incidents`,
        tone: evidenceCount ? "healthy" : "attention",
        href: "/evidence-sources",
      },
      {
        label: "Remediation",
        value: system.remediation.configured ? "Configured" : "Unavailable",
        detail: "Production mutations remain approval-gated",
        tone: system.remediation.configured ? "healthy" : "attention",
        href: "/safety",
      },
    ],
    activity: incidentOverview.incidents.slice(0, 3).map((incident) => ({
      id: `incident-${incident.id}`,
      title: `${incident.id} · ${incident.status}`,
      detail: incident.diagnosis,
      time: incident.updated,
      actor: "Podo Core",
      kind: "system" as const,
      href: `/?incident=${encodeURIComponent(incident.id)}#workspace`,
    })),
  }
}
