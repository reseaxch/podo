import { NextResponse } from "next/server"

import { createDashboardClient } from "../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

async function state(id: string) {
  const client = createDashboardClient()
  const [{ incident }, { events }, remediationResult, deliveryResult] =
    await Promise.all([
      client.getBuildIncident(id),
      client.getBuildIncidentAudit(id),
      optional(() => client.getIncidentRemediation(id)),
      optional(() => client.getIncidentDelivery(id)),
    ])
  return {
    incident,
    events,
    remediation: remediationResult?.remediation ?? null,
    delivery: deliveryResult?.delivery ?? null,
  }
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  return NextResponse.json(await state(id))
}

type Command =
  | { action: "start-retry" }
  | { action: "decide-retry"; approvalId: string; decision: "approve" | "deny" }
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
  | { action: "start-verification" }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  const command = (await request.json()) as Command
  const client = createDashboardClient()
  switch (command.action) {
    case "start-retry":
      await client.startBuildIncidentRetry(id)
      break
    case "decide-retry":
      await client.decideBuildIncidentRetry(id, command.approvalId, {
        decision: command.decision,
      })
      break
    case "start-remediation":
      await client.startIncidentRemediation(id)
      break
    case "decide-remediation":
      if (command.decision === "approve")
        await client.approveIncidentRemediation(id, command.approvalId)
      else await client.denyIncidentRemediation(id, command.approvalId)
      break
    case "start-delivery":
      await client.startIncidentDelivery(id)
      break
    case "decide-delivery":
      if (command.decision === "approve")
        await client.approveIncidentDelivery(id, command.approvalId)
      else await client.denyIncidentDelivery(id, command.approvalId)
      break
    case "start-verification":
      await client.startBuildRemediationVerification(id)
      break
    default:
      return NextResponse.json(
        {
          error: "invalid_action",
          message: "Unsupported build incident action",
        },
        { status: 400 },
      )
  }
  return NextResponse.json(await state(id))
}
