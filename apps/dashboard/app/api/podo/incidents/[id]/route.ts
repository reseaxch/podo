import { NextResponse } from "next/server"

import {
  createDashboardClient,
  incidentWorkingDirectory,
} from "../../../../lib/dashboard-client"
import {
  getIncidentCausalPath,
  getIncidentEvidenceRecords,
  getIncidentWorkflow,
  toCoreIncidentWorkspace,
} from "../../../../lib/incident-data"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  const client = createDashboardClient()
  const { incident } = await client.getIncident(id)
  const [workflow, causalPath, records] = await Promise.all([
    getIncidentWorkflow(id, client),
    getIncidentCausalPath(incident, client),
    getIncidentEvidenceRecords(id, client),
  ])

  return NextResponse.json({
    workspace: toCoreIncidentWorkspace({
      incident,
      records,
      causalPath,
      ...workflow,
    }),
  })
}

type Command =
  | { action: "start-investigation" }
  | { action: "start-remediation" }
  | {
      action: "decide-remediation"
      approvalId: string
      decision: "approve" | "deny"
    }
  | { action: "start-delivery" }
  | { action: "start-issue" }
  | {
      action: "decide-delivery"
      approvalId: string
      decision: "approve" | "deny"
    }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  const command = (await request.json()) as Command
  const client = createDashboardClient()

  switch (command.action) {
    case "start-investigation": {
      const result = await client.startIncidentInvestigation(id, {
        cwd: incidentWorkingDirectory(),
      })
      return NextResponse.json(result)
    }
    case "start-remediation":
      return NextResponse.json(await client.startIncidentRemediation(id))
    case "decide-remediation": {
      const result =
        command.decision === "approve"
          ? await client.approveIncidentRemediation(id, command.approvalId)
          : await client.denyIncidentRemediation(id, command.approvalId)
      return NextResponse.json(result)
    }
    case "start-delivery":
      return NextResponse.json(await client.startIncidentDelivery(id))
    case "start-issue":
      return NextResponse.json(await client.startIncidentIssue(id))
    case "decide-delivery": {
      const result =
        command.decision === "approve"
          ? await client.approveIncidentDelivery(id, command.approvalId)
          : await client.denyIncidentDelivery(id, command.approvalId)
      return NextResponse.json(result)
    }
    default:
      return NextResponse.json(
        { error: "invalid_action", message: "Unsupported incident action" },
        { status: 400 },
      )
  }
}

export type IncidentWorkflowResponse = {
  workspace: import("../../../../lib/incident-types").IncidentWorkspaceViewModel
}
