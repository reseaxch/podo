import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { BuildIncidentWorkspace } from "../../components/build-incidents/build-incident-workspace"
import { getBuildIncidentState } from "../../lib/build-incidents-data"
import { getDashboardShellContext } from "../../lib/dashboard-shell"
import { isTrustedOperatorMode } from "../../lib/dashboard-client"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Build incident | Podo" }

export default async function BuildIncidentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let initial: Awaited<ReturnType<typeof getBuildIncidentState>>
  try {
    initial = await getBuildIncidentState(id)
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) notFound()
    throw error
  }
  if (!initial) notFound()
  return (
    <BuildIncidentWorkspace
      initial={initial}
      shell={getDashboardShellContext()}
      mutationsEnabled={isTrustedOperatorMode()}
    />
  )
}
