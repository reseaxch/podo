import { NextResponse } from "next/server"

import {
  createDashboardClient,
  isDemoDashboard,
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

export async function POST(request: Request) {
  try {
    await request.body?.cancel("build_incidents_read_only")
  } catch {
    // The request is rejected before parsing; cancellation is best-effort.
  }

  const demo = isDemoDashboard()
  return NextResponse.json(
    {
      error: demo ? "demo_read_only" : "operator_identity_required",
      message: demo
        ? "Build incident actions are disabled in the demo workspace."
        : "Build incident actions require an authenticated operator boundary.",
    },
    { status: 405, headers: { allow: "GET" } },
  )
}
