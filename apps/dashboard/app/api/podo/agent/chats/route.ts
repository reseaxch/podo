import {
  agentSurfaceUnavailable,
  isEmptyObject,
  readBoundedJson,
  safeAgentError,
} from "../../../../lib/agent-chat-route"
import { createDashboardClient } from "../../../../lib/dashboard-client"

export async function POST(request: Request) {
  const unavailable = agentSurfaceUnavailable()
  if (unavailable) return unavailable
  const input = await readBoundedJson(request)
  if (!input.ok) return input.response
  if (!isEmptyObject(input.value))
    return Response.json(
      {
        error: "invalid_request",
        message: "No caller-authored chat configuration is accepted",
      },
      { status: 400 },
    )
  try {
    return Response.json(await createDashboardClient().createAgentChat(), {
      status: 201,
    })
  } catch (error) {
    return safeAgentError(error)
  }
}
