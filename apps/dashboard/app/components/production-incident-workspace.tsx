"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  IncidentController,
  IncidentTab,
  IncidentWorkflowCommand,
  IncidentWorkspaceViewModel,
} from "../lib/incident-types"
import { IncidentWorkspace } from "./incident-workspace"

type WorkspaceResponse = {
  workspace: IncidentWorkspaceViewModel
}

export function ProductionIncidentWorkspace({
  initialTab = "evidence",
  workspace: initialWorkspace,
}: {
  initialTab?: IncidentTab
  workspace: IncidentWorkspaceViewModel
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace)

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/podo/incidents/${encodeURIComponent(initialWorkspace.id)}`,
      { cache: "no-store" },
    )
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`)
    const result = (await response.json()) as WorkspaceResponse
    setWorkspace(result.workspace)
  }, [initialWorkspace.id])

  const controller = useMemo<IncidentController>(
    () => ({
      async updateStatus() {
        throw new Error("Incident status is owned by Core lifecycle state")
      },
      async requestChanges() {
        throw new Error("Core does not accept unbound remediation feedback")
      },
      async approveAndCreatePullRequest() {
        throw new Error("Use the explicit Core delivery approval")
      },
      async returnToReview() {
        throw new Error("Core remediation state cannot be rewound by the UI")
      },
      async executeWorkflow(command: IncidentWorkflowCommand) {
        const response = await fetch(
          `/api/podo/incidents/${encodeURIComponent(initialWorkspace.id)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          },
        )
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as {
            message?: string
          } | null
          throw new Error(
            detail?.message ?? `Core action failed (${response.status})`,
          )
        }
        await refresh()
      },
    }),
    [initialWorkspace.id, refresh],
  )

  const workflow = workspace.workflow
  const active =
    workflow?.incident.investigation?.status === "starting" ||
    workflow?.incident.investigation?.status === "running" ||
    workflow?.remediation?.status === "running" ||
    workflow?.delivery?.status === "delivering" ||
    workflow?.issueDelivery?.status === "creating"

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  return (
    <IncidentWorkspace
      controller={controller}
      incident={workspace}
      initialTab={initialTab}
    />
  )
}
