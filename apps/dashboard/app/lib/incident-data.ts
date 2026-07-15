import type { PodoClient } from "@podo/client"
import type {
  DetectedIncident,
  IncidentDelivery,
  IncidentRemediation,
} from "@podo/contracts"

import { incidentMock } from "../mocks/incident"

import type { IncidentWorkspaceViewModel } from "./incident-types"
import { createDashboardClient } from "./dashboard-client"

type GetIncidentWorkspaceOptions = {
  client?: PodoClient
  incidentId?: string
}

export function getDemoIncidentWorkspace(): IncidentWorkspaceViewModel {
  return structuredClone(incidentMock)
}

export async function getIncidentWorkspace(
  options: GetIncidentWorkspaceOptions = {},
): Promise<DetectedIncident | null> {
  const client = options.client ?? createDashboardClient()
  if (options.incidentId) {
    const { incident } = await client.getIncident(options.incidentId)
    return incident
  }

  const { incidents } = await client.listIncidents()
  return (
    incidents.toSorted((left, right) => {
      const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt)
      return byUpdatedAt || right.id.localeCompare(left.id)
    })[0] ?? null
  )
}

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

export async function getIncidentWorkflow(
  incidentId: string,
  client = createDashboardClient(),
): Promise<{
  remediation: IncidentRemediation | null
  delivery: IncidentDelivery | null
}> {
  const [remediation, delivery] = await Promise.all([
    optional(() => client.getIncidentRemediation(incidentId)),
    optional(() => client.getIncidentDelivery(incidentId)),
  ])
  return {
    remediation: remediation?.remediation ?? null,
    delivery: delivery?.delivery ?? null,
  }
}
