import {
  agentSurfaceUnavailable,
  isAgentMessage,
  readBoundedJson,
  safeAgentError,
} from "../../../../../../lib/agent-chat-route"
import { createDashboardClient } from "../../../../../../lib/dashboard-client"

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const unavailable = agentSurfaceUnavailable()
  if (unavailable) return unavailable
  const input = await readBoundedJson(request)
  if (!input.ok) return input.response
  if (!isAgentMessage(input.value))
    return Response.json(
      {
        error: "invalid_request",
        message:
          "content and clientRequestId are required; no other fields are accepted",
      },
      { status: 400 },
    )
  const { id } = await context.params
  try {
    const result = await createDashboardClient().sendAgentChatMessage(
      id,
      input.value,
    )
    return Response.json(result, { status: result.accepted ? 202 : 200 })
  } catch (error) {
    return safeAgentError(error)
  }
}
