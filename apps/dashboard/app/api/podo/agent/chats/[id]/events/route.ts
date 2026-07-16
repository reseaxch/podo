import {
  agentEventStream,
  agentSurfaceUnavailable,
  parseAfterSequence,
} from "../../../../../../lib/agent-chat-route"
import { createDashboardClient } from "../../../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  const unavailable = agentSurfaceUnavailable()
  if (unavailable) return unavailable
  const afterSequence = parseAfterSequence(request)
  if (afterSequence instanceof Response) return afterSequence
  const { id } = await context.params
  return agentEventStream(request, createDashboardClient(), id, afterSequence)
}
