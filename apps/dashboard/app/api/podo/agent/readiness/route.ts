import {
  agentSurfaceUnavailable,
  safeAgentError,
} from "../../../../lib/agent-chat-route"
import { createDashboardClient } from "../../../../lib/dashboard-client"

export async function GET() {
  const unavailable = agentSurfaceUnavailable()
  if (unavailable) return unavailable
  try {
    return Response.json(await createDashboardClient().agentReadiness())
  } catch (error) {
    return safeAgentError(error)
  }
}
