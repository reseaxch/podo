import { NextResponse } from "next/server"

import { createDashboardClient } from "../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

type AgentCommand =
  | { action: "cancel" }
  | {
      action: "decide"
      approvalId: string
      decision: "approve" | "deny"
      answers?: Record<string, string[]>
    }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  const command = (await request.json()) as AgentCommand
  const client = createDashboardClient()

  if (command.action === "cancel")
    return NextResponse.json(await client.cancelInvestigation(id))

  if (command.action === "decide") {
    const result =
      command.decision === "approve"
        ? await client.approve(id, command.approvalId, command.answers)
        : await client.deny(id, command.approvalId)
    return NextResponse.json(result)
  }

  return NextResponse.json(
    { error: "invalid_action", message: "Unsupported agent action" },
    { status: 400 },
  )
}
