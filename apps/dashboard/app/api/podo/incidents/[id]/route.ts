import type { IncidentDelivery, IncidentRemediation } from "@podo/contracts"
import { NextResponse } from "next/server"

import {
  createDashboardClient,
  incidentWorkingDirectory,
} from "../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  const client = createDashboardClient()
  const [{ incident }, remediationResult, deliveryResult] = await Promise.all([
    client.getIncident(id),
    optional(() => client.getIncidentRemediation(id)),
    optional(() => client.getIncidentDelivery(id)),
  ])

  return NextResponse.json({
    incident,
    remediation: remediationResult?.remediation ?? null,
    delivery: deliveryResult?.delivery ?? null,
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
  incident: import("@podo/contracts").DetectedIncident
  remediation: IncidentRemediation | null
  delivery: IncidentDelivery | null
}
