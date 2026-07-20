import type { Metadata } from "next"

import { IncidentsOverview } from "../components/incidents/incidents-overview"
import { getIncidentOverview } from "../lib/incidents-data"
import { isDemoDashboard } from "../lib/dashboard-client"

export default async function IncidentsPage() {
  const overview = await getIncidentOverview()
  return (
    <IncidentsOverview
      overview={overview}
      source={isDemoDashboard() ? "demo" : "core"}
    />
  )
}
export const metadata: Metadata = { title: "Incidents | Podo" }
