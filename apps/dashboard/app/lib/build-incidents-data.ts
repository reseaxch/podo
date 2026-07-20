import type { createPodoClient } from "@podo/client"

import { createDashboardClient, isDemoDashboard } from "./dashboard-client"

type DashboardClient = ReturnType<typeof createPodoClient>

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

export async function getBuildIncidents(client?: DashboardClient) {
  if (isDemoDashboard()) {
    const { buildIncidentMock } = await import("../mocks/build-incidents")
    return [structuredClone(buildIncidentMock)]
  }
  return (await (client ?? createDashboardClient()).listBuildIncidents())
    .incidents
}

export async function getBuildIncidentState(
  id: string,
  client?: DashboardClient,
) {
  let incidentId = id
  try {
    incidentId = decodeURIComponent(id)
  } catch {
    return null
  }
  if (isDemoDashboard()) {
    const { buildIncidentAuditMock, buildIncidentMock } =
      await import("../mocks/build-incidents")
    if (incidentId !== buildIncidentMock.id) return null
    return {
      incident: structuredClone(buildIncidentMock),
      events: structuredClone(buildIncidentAuditMock),
      remediation: null,
      delivery: null,
    }
  }
  const core = client ?? createDashboardClient()
  const [{ incident }, { events }, remediationResult, deliveryResult] =
    await Promise.all([
      core.getBuildIncident(incidentId),
      core.getBuildIncidentAudit(incidentId),
      optional(() => core.getIncidentRemediation(incidentId)),
      optional(() => core.getIncidentDelivery(incidentId)),
    ])
  return {
    incident,
    events,
    remediation: remediationResult?.remediation ?? null,
    delivery: deliveryResult?.delivery ?? null,
  }
}
