"use client"

import { useState } from "react"

import type {
  IncidentController,
  IncidentTab,
  IncidentWorkspaceViewModel,
} from "../lib/incident-types"
import { createMockIncidentController } from "../mocks/incident-controller"
import type { GraphNodeId } from "../mocks/incident"
import { IncidentWorkspace } from "./incident-workspace"

export function DemoIncidentWorkspace({
  incident,
  initialGraphNodeId,
  initialTab = "evidence",
}: {
  incident: IncidentWorkspaceViewModel
  initialGraphNodeId?: GraphNodeId | undefined
  initialTab?: IncidentTab
}) {
  const [controller] = useState<IncidentController>(() =>
    createMockIncidentController(
      incident.id,
      incident.remediation,
      incident.status,
    ),
  )

  return (
    <IncidentWorkspace
      controller={controller}
      incident={incident}
      initialGraphNodeId={initialGraphNodeId}
      initialTab={initialTab}
    />
  )
}
