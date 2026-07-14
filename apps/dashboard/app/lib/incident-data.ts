import { createRootlineClient, type RootlineClient } from "@rootline/client"
import type { DetectedIncident } from "@rootline/contracts"

type GetIncidentWorkspaceOptions = {
  client?: RootlineClient
  incidentId?: string
}

function createDashboardClient(): RootlineClient {
  return createRootlineClient({
    baseUrl: process.env.ROOTLINE_CORE_URL ?? "http://127.0.0.1:4100",
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  })
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
