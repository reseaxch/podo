import type {
  IncidentTab,
  IncidentWorkspaceViewModel,
} from "../lib/incident-types"
import { graphNodeDetails, type GraphNodeId } from "../mocks/incident"
import { DemoIncidentWorkspace } from "./demo-incident-workspace"

function isGraphNodeId(node: string | undefined): node is GraphNodeId {
  return Boolean(node && node in graphNodeDetails)
}

export function DemoIncidentRoute({
  incident,
  initialTab,
  node,
}: {
  incident: IncidentWorkspaceViewModel
  initialTab: IncidentTab
  node?: string | undefined
}) {
  return (
    <DemoIncidentWorkspace
      incident={incident}
      initialGraphNodeId={isGraphNodeId(node) ? node : undefined}
      initialTab={initialTab}
    />
  )
}
