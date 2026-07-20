import { IncidentPageState } from "./components/incident-page-state"
import { ProductionIncidentWorkspace } from "./components/production-incident-workspace"
import {
  getDemoIncidentWorkspace,
  getIncidentCausalPath,
  getIncidentEvidenceRecords,
  getIncidentWorkflow,
  getIncidentWorkspace,
  toCoreIncidentWorkspace,
} from "./lib/incident-data"
import type { IncidentTab } from "./lib/incident-types"
import { isDemoDashboard } from "./lib/dashboard-client"

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

export default async function Page({ searchParams }: PageProps) {
  const { incident: incidentId, mode, node, state, tab } = await searchParams
  const initialTab = isIncidentTab(tab) ? tab : "evidence"
  if (state === "error") throw new Error("Synthetic incident request failed")
  if (state === "empty") return <IncidentPageState kind="empty" />

  if (mode !== "live" && (mode === "demo" || isDemoDashboard())) {
    const { DemoIncidentRoute } =
      await import("./components/demo-incident-route")
    return (
      <DemoIncidentRoute
        incident={await getDemoIncidentWorkspace()}
        initialTab={initialTab}
        node={node}
      />
    )
  }

  const incident = await getIncidentWorkspace(
    incidentId ? { incidentId } : undefined,
  )
  if (!incident) return <IncidentPageState kind="empty" />
  const [workflow, causalPath, records] = await Promise.all([
    getIncidentWorkflow(incident.id),
    getIncidentCausalPath(incident),
    getIncidentEvidenceRecords(incident.id),
  ])
  return (
    <ProductionIncidentWorkspace
      initialTab={initialTab}
      workspace={toCoreIncidentWorkspace({
        incident,
        records,
        causalPath,
        ...workflow,
      })}
    />
  )
}
