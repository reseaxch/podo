import type { IncidentDelivery, IncidentRemediation } from "@podo/contracts"

import { incidentOverviewMock } from "../mocks/incidents"
import { createDashboardClient, isDemoDashboard } from "./dashboard-client"
import type {
  IncidentOverviewStatus,
  IncidentOverviewViewModel,
  IncidentSummary,
} from "./incident-overview-types"

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

function workflowStatus(
  investigationStatus: string | undefined,
  remediation: IncidentRemediation | null,
  delivery: IncidentDelivery | null,
): IncidentOverviewStatus {
  if (delivery?.status === "delivered") return "Resolved"
  if (
    remediation?.status === "pending_approval" ||
    delivery?.status === "pending_approval"
  )
    return "Awaiting approval"
  if (remediation?.status === "completed") return "Monitoring"
  if (investigationStatus === "completed") return "Monitoring"
  return "Investigating"
}

export async function getIncidentOverview(): Promise<IncidentOverviewViewModel> {
  if (isDemoDashboard()) return structuredClone(incidentOverviewMock)

  const client = createDashboardClient()
  const { incidents } = await client.listIncidents()
  const summaries: IncidentSummary[] = await Promise.all(
    incidents.map(async (incident) => {
      const [remediationResult, deliveryResult] = await Promise.all([
        optional(() => client.getIncidentRemediation(incident.id)),
        optional(() => client.getIncidentDelivery(incident.id)),
      ])
      const remediation = remediationResult?.remediation ?? null
      const delivery = deliveryResult?.delivery ?? null
      const status = workflowStatus(
        incident.investigation?.status,
        remediation,
        delivery,
      )
      const diagnosis =
        incident.diagnosis?.status === "validated" ? incident.diagnosis : null
      return {
        id: incident.id,
        title: `Cache growth detected in ${incident.affectedService}`,
        severity: "P1",
        status,
        service: incident.affectedService,
        diagnosis:
          diagnosis?.probableRootCause ??
          (incident.diagnosis?.status === "failed"
            ? "Diagnosis failed closed"
            : "Evidence collection in progress"),
        confidence: diagnosis ? diagnosis.confidence.value / 100 : null,
        evidenceCount: incident.evidence.length,
        updated: new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(incident.updatedAt)),
        owner: { name: "Podo Core", initials: "PC" },
        hasWorkspace: true,
        ...(status === "Awaiting approval"
          ? { attentionReason: "Needs approval" as const }
          : { attentionReason: "SLO breached" as const }),
      }
    }),
  )

  return {
    owner: { name: "Podo Core", avatar: "/icon.svg" },
    generatedAt: "Updated from Core",
    incidents: summaries,
  }
}
