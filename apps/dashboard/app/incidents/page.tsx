import { IncidentsOverview } from "../components/incidents/incidents-overview"
import { getIncidentOverview } from "../lib/incidents-data"

export default async function IncidentsPage() {
  const overview = await getIncidentOverview()
  return <IncidentsOverview overview={overview} />
}
