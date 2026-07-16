export const agentChatTransportFailureKind = "transport.failed" as const

export type AgentChatTransportFailure = {
  kind: typeof agentChatTransportFailureKind
  error: {
    code: "agent_stream_unavailable"
    message: "The Podo agent stream became unavailable"
  }
}

export function agentChatTransportFailure(): AgentChatTransportFailure {
  return {
    kind: agentChatTransportFailureKind,
    error: {
      code: "agent_stream_unavailable",
      message: "The Podo agent stream became unavailable",
    },
  }
}

export function isAgentChatTransportFailure(
  value: unknown,
): value is AgentChatTransportFailure {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (input.kind !== agentChatTransportFailureKind) return false
  const error = input.error
  return (
    Boolean(error) &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    (error as Record<string, unknown>).code === "agent_stream_unavailable" &&
    (error as Record<string, unknown>).message ===
      "The Podo agent stream became unavailable"
  )
}
