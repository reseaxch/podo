import {
  agentSurfaceUnavailable,
  safeAgentError,
} from "../../../../../lib/agent-chat-route"
import { createDashboardClient } from "../../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const unavailable = agentSurfaceUnavailable()
  if (unavailable) return unavailable
  const { id } = await context.params
  try {
    return Response.json(await createDashboardClient().getAgentChat(id))
  } catch (error) {
    return safeAgentError(error)
  }
}
