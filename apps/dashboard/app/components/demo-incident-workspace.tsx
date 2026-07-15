"use client"

import { useState } from "react"

import type {
  IncidentController,
  IncidentWorkspaceViewModel,
} from "../lib/incident-types"
import { createMockIncidentController } from "../mocks/incident-controller"
import { IncidentWorkspace } from "./incident-workspace"

export function DemoIncidentWorkspace({
  incident,
}: {
  incident: IncidentWorkspaceViewModel
}) {
  const [controller] = useState<IncidentController>(() =>
    createMockIncidentController(
      incident.id,
      incident.remediation,
      incident.status,
    ),
  )

  return <IncidentWorkspace controller={controller} incident={incident} />
}
