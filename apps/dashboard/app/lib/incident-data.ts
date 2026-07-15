import { createPodoClient, type PodoClient } from "@podo/client"
import type { DetectedIncident } from "@podo/contracts"

import { incidentMock } from "../mocks/incident"

import type { IncidentWorkspaceViewModel } from "./incident-types"

type GetIncidentWorkspaceOptions = {
  client?: PodoClient
  incidentId?: string
}

function createDashboardClient(): PodoClient {
  return createPodoClient({
    baseUrl: process.env.PODO_CORE_URL ?? "http://127.0.0.1:4100",
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  })
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
