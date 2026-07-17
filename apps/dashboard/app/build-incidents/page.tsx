import type { Metadata } from "next"

import { BuildIncidentsOverview } from "../components/build-incidents/build-incidents-overview"
import { createDashboardClient } from "../lib/dashboard-client"
import { getDashboardShellContext } from "../lib/dashboard-shell"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Build incidents | Podo" }

export default async function BuildIncidentsPage() {
  const { incidents } = await createDashboardClient().listBuildIncidents()
  return (
    <BuildIncidentsOverview
      incidents={incidents}
      shell={getDashboardShellContext()}
    />
  )
}
