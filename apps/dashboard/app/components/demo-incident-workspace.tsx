"use client"

import { useState } from "react"

import type {
  IncidentWorkspaceViewModel,
  RemediationController,
} from "../lib/incident-types"
import { createMockIncidentController } from "../mocks/incident-controller"
import { IncidentWorkspace } from "./incident-workspace"

export function DemoIncidentWorkspace({
  incident,
}: {
  incident: IncidentWorkspaceViewModel
}) {
  const [controller] = useState<RemediationController>(() =>
    createMockIncidentController(incident.id, incident.remediation),
  )

  return <IncidentWorkspace controller={controller} incident={incident} />
}
