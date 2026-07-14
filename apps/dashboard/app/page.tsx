import { IncidentPageState } from "./components/incident-page-state"
import { IncidentWorkspace } from "./components/incident-workspace"
import { getIncidentWorkspace } from "./lib/incident-data"

type PageProps = { searchParams: Promise<{ state?: string }> }

export default async function Page({ searchParams }: PageProps) {
  const { state } = await searchParams
  if (state === "error") throw new Error("Mock incident request failed")
  if (state === "empty") return <IncidentPageState kind="empty" />

  const incident = await getIncidentWorkspace()
  if (!incident) return <IncidentPageState kind="empty" />
  return <IncidentWorkspace incident={incident} />
}
