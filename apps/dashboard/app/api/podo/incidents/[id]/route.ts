import { NextResponse } from "next/server"

import {
  createDashboardClient,
  incidentWorkingDirectory,
  isTrustedOperatorMode,
  trustedMutationRequestError,
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

function commandFrom(value: unknown): Command | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (
    [
      "start-investigation",
      "start-remediation",
      "start-delivery",
      "start-issue",
    ].includes(String(input.action))
  )
    return Object.keys(input).length === 1 ? (input as Command) : null
  if (
    input.action !== "decide-remediation" &&
    input.action !== "decide-delivery"
  )
    return null
  return Object.keys(input).length === 3 &&
    typeof input.approvalId === "string" &&
    input.approvalId.length > 0 &&
    input.approvalId.length <= 256 &&
    (input.decision === "approve" || input.decision === "deny")
    ? (input as Command)
    : null
}

export async function POST(request: Request, context: Context) {
  if (!isTrustedOperatorMode())
    return NextResponse.json(
      {
        error: "trusted_operator_mode_required",
        message: "Mutations require an explicitly trusted private deployment.",
      },
      { status: 405, headers: { allow: "GET" } },
    )
  const requestError = trustedMutationRequestError(request)
  if (requestError)
    return NextResponse.json(
      { error: requestError.error },
      { status: requestError.status },
    )
  let command: Command | null = null
  try {
    command = commandFrom(await request.json())
  } catch {
    // Invalid JSON is handled as an invalid command.
  }
  if (!command)
    return NextResponse.json(
      { error: "invalid_action", message: "Unsupported incident action" },
      { status: 400 },
    )
  const { id } = await context.params
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
