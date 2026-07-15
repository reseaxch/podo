import { DemoIncidentWorkspace } from "./components/demo-incident-workspace"
import { IncidentPageState } from "./components/incident-page-state"
import { ProductionIncidentWorkspace } from "./components/production-incident-workspace"
import {
  getDemoIncidentWorkspace,
  getIncidentWorkflow,
  getIncidentWorkspace,
} from "./lib/incident-data"
import type { IncidentTab } from "./lib/incident-types"
import { isDemoDashboard } from "./lib/dashboard-client"
import { graphNodeDetails, type GraphNodeId } from "./mocks/incident"

export const dynamic = "force-dynamic"

type PageProps = {
  searchParams: Promise<{
    incident?: string
    mode?: string
    state?: string
    tab?: string
    node?: string
  }>
}

function isIncidentTab(tab: string | undefined): tab is IncidentTab {
  return tab === "evidence" || tab === "graph" || tab === "changes"
}

function isGraphNodeId(node: string | undefined): node is GraphNodeId {
  return Boolean(node && node in graphNodeDetails)
}

export default async function Page({ searchParams }: PageProps) {
  const { incident: incidentId, mode, node, state, tab } = await searchParams
  const initialTab = isIncidentTab(tab) ? tab : "evidence"
  if (state === "error") throw new Error("Synthetic incident request failed")
  if (state === "empty") return <IncidentPageState kind="empty" />

  if (mode !== "live" && (mode === "demo" || isDemoDashboard()))
    return (
      <DemoIncidentWorkspace
        incident={getDemoIncidentWorkspace()}
        initialGraphNodeId={isGraphNodeId(node) ? node : undefined}
        initialTab={initialTab}
      />
    )

  const incident = await getIncidentWorkspace(
    incidentId ? { incidentId } : undefined,
  )
  if (!incident) return <IncidentPageState kind="empty" />
  const workflow = await getIncidentWorkflow(incident.id)
  return <ProductionIncidentWorkspace incident={incident} {...workflow} />
}
