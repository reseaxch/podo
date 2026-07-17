import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { BuildIncidentWorkspace } from "../../components/build-incidents/build-incident-workspace"
import { createDashboardClient } from "../../lib/dashboard-client"
import { getDashboardShellContext } from "../../lib/dashboard-shell"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Build incident | Podo" }

export default async function BuildIncidentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const client = createDashboardClient()
  let initial: Awaited<ReturnType<typeof loadBuildIncident>>
  try {
    initial = await loadBuildIncident(client, id)
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) notFound()
    throw error
  }
  return (
    <BuildIncidentWorkspace
      initial={initial}
      shell={getDashboardShellContext()}
    />
  )
}

async function loadBuildIncident(
  client: ReturnType<typeof createDashboardClient>,
  id: string,
) {
  const [{ incident }, { events }, remediationResult, deliveryResult] =
    await Promise.all([
      client.getBuildIncident(id),
      client.getBuildIncidentAudit(id),
      optional(() => client.getIncidentRemediation(id)),
      optional(() => client.getIncidentDelivery(id)),
    ])
  return {
    incident,
    events,
    remediation: remediationResult?.remediation ?? null,
    delivery: deliveryResult?.delivery ?? null,
  }
}

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}
