import { NextResponse } from "next/server"

import { createDashboardClient } from "../../../lib/dashboard-client"
import { getSafetyApprovals } from "../../../lib/safety-data"
import type { ApprovalDecisionInput } from "../../../lib/safety-types"

export async function GET() {
  return NextResponse.json(await getSafetyApprovals())
}

export async function POST(request: Request) {
  const input = (await request.json()) as ApprovalDecisionInput
  const [kind, incidentId, approvalId] = input.requestId.split(":")
  if (!kind || !incidentId || !approvalId)
    return NextResponse.json(
      { message: "Invalid approval request" },
      { status: 400 },
    )
  const client = createDashboardClient()
  if (kind === "remediation") {
    if (input.decision === "approve")
      await client.approveIncidentRemediation(incidentId, approvalId)
    else await client.denyIncidentRemediation(incidentId, approvalId)
  } else if (kind === "delivery") {
    if (input.decision === "approve")
      await client.approveIncidentDelivery(incidentId, approvalId)
    else await client.denyIncidentDelivery(incidentId, approvalId)
  } else {
    return NextResponse.json(
      { message: "Unsupported approval request" },
      { status: 400 },
    )
  }
  return NextResponse.json(await getSafetyApprovals())
}
