import { NextResponse } from "next/server"

import { getBuildIncidentState } from "../../../../lib/build-incidents-data"
import {
  createDashboardClient,
  isDemoDashboard,
  isTrustedOperatorMode,
  trustedMutationRequestError,
} from "../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  const result = await getBuildIncidentState(id)
  return result
    ? NextResponse.json(result)
    : NextResponse.json({ error: "not_found" }, { status: 404 })
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

function commandFrom(value: unknown): Command | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const action = input.action
  if (
    [
      "start-retry",
      "start-remediation",
      "start-delivery",
      "start-verification",
    ].includes(String(action))
  )
    return Object.keys(input).length === 1 ? (input as Command) : null
  if (
    !["decide-retry", "decide-remediation", "decide-delivery"].includes(
      String(action),
    )
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
  if (!isTrustedOperatorMode()) {
    try {
      await request.body?.cancel("build_incidents_read_only")
    } catch {
      // The request is rejected before parsing; cancellation is best-effort.
    }
    const demo = isDemoDashboard()
    return NextResponse.json(
      {
        error: demo ? "demo_read_only" : "trusted_operator_mode_required",
        message: demo
          ? "Build incident actions are disabled in the demo workspace."
          : "Enable trusted operator mode only for a private, single-operator deployment.",
      },
      { status: 405, headers: { allow: "GET" } },
    )
  }

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
      {
        error: "invalid_command",
        message: "Unsupported build incident action.",
      },
      { status: 400 },
    )

  const { id } = await context.params
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
      await (command.decision === "approve"
        ? client.approveIncidentRemediation(id, command.approvalId)
        : client.denyIncidentRemediation(id, command.approvalId))
      break
    case "start-delivery":
      await client.startIncidentDelivery(id)
      break
    case "decide-delivery":
      await (command.decision === "approve"
        ? client.approveIncidentDelivery(id, command.approvalId)
        : client.denyIncidentDelivery(id, command.approvalId))
      break
    case "start-verification":
      await client.startBuildRemediationVerification(id)
      break
  }
  const result = await getBuildIncidentState(id, client)
  return result
    ? NextResponse.json(result)
    : NextResponse.json({ error: "not_found" }, { status: 404 })
}
