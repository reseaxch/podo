import { NextResponse } from "next/server"

import {
  createDashboardClient,
  isTrustedOperatorMode,
  trustedMutationRequestError,
} from "../../../lib/dashboard-client"
import {
  decodeApprovalRequestId,
  getSafetyApprovals,
} from "../../../lib/safety-data"

export async function GET() {
  return NextResponse.json(await getSafetyApprovals())
}

export async function POST(request: Request) {
  if (!isTrustedOperatorMode())
    return NextResponse.json(
      {
        error: "trusted_operator_mode_required",
        message:
          "Safety decisions require an explicitly trusted private deployment.",
      },
      { status: 405, headers: { allow: "GET" } },
    )
  const requestError = trustedMutationRequestError(request)
  if (requestError)
    return NextResponse.json(
      { error: requestError.error },
      { status: requestError.status },
    )
  let input: unknown
  try {
    input = await request.json()
  } catch {
    input = null
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const body = input as Record<string, unknown>
  const target =
    typeof body.requestId === "string"
      ? decodeApprovalRequestId(body.requestId)
      : null
  const decision = body.decision
  if (
    !target ||
    (decision !== "approve" && decision !== "deny") ||
    body.expectedStatus !== "pending" ||
    !Number.isInteger(body.expectedRevision) ||
    typeof body.reason !== "string" ||
    body.reason.length > 2_000 ||
    Object.keys(body).some(
      (key) =>
        ![
          "requestId",
          "decision",
          "reason",
          "expectedStatus",
          "expectedRevision",
        ].includes(key),
    )
  )
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const current = await getSafetyApprovals()
  const approval = current.requests.find((item) => item.id === body.requestId)
  if (
    !approval ||
    approval.status !== "pending" ||
    current.revision !== body.expectedRevision
  )
    return NextResponse.json(
      {
        error: "stale_approval",
        message: "Approval state changed; refresh and review it again.",
      },
      { status: 409 },
    )
  if (!approval.canApprove)
    return NextResponse.json(
      { error: "approval_blocked", message: approval.blockedReason },
      { status: 409 },
    )
  const client = createDashboardClient()
  if (target.kind === "build-retry")
    await client.decideBuildIncidentRetry(
      target.incidentId,
      target.approvalId,
      { decision },
    )
  else if (target.kind === "remediation")
    await (decision === "approve"
      ? client.approveIncidentRemediation(target.incidentId, target.approvalId)
      : client.denyIncidentRemediation(target.incidentId, target.approvalId))
  else
    await (decision === "approve"
      ? client.approveIncidentDelivery(target.incidentId, target.approvalId)
      : client.denyIncidentDelivery(target.incidentId, target.approvalId))
  return NextResponse.json(await getSafetyApprovals())
}
