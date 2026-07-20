import type { Metadata } from "next"

import { BuildIncidentsOverview } from "../components/build-incidents/build-incidents-overview"
import { getBuildIncidents } from "../lib/build-incidents-data"
import { getDashboardShellContext } from "../lib/dashboard-shell"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Build incidents | Podo" }

export default async function BuildIncidentsPage() {
  return (
    <BuildIncidentsOverview
      incidents={await getBuildIncidents()}
      shell={getDashboardShellContext()}
    />
  )
}
