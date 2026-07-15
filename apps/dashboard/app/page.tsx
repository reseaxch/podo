import { DemoIncidentWorkspace } from "./components/demo-incident-workspace"
import { IncidentPageState } from "./components/incident-page-state"
import { ProductionIncidentWorkspace } from "./components/production-incident-workspace"
import {
  getDemoIncidentWorkspace,
  getIncidentWorkspace,
} from "./lib/incident-data"

export const dynamic = "force-dynamic"

type PageProps = {
  searchParams: Promise<{
    incident?: string
    mode?: string
    state?: string
  }>
}

export default async function Page({ searchParams }: PageProps) {
  const { incident: incidentId, mode, state } = await searchParams
  if (state === "error") throw new Error("Synthetic incident request failed")
  if (state === "empty") return <IncidentPageState kind="empty" />

  if (mode === "live") {
    const incident = await getIncidentWorkspace(
      incidentId ? { incidentId } : undefined,
    )
    if (!incident) return <IncidentPageState kind="empty" />
    return <ProductionIncidentWorkspace incident={incident} />
  }

  return <DemoIncidentWorkspace incident={getDemoIncidentWorkspace()} />
}
