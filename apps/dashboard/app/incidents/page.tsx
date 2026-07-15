import { IncidentsOverview } from "../components/incidents/incidents-overview"
import { getIncidentOverview } from "../lib/incidents-data"

export default function IncidentsPage() {
  const overview = getIncidentOverview()
  return <IncidentsOverview overview={overview} />
}
