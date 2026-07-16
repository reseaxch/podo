import type { PodoAgentChatClient } from "@podo/client"
import type {
  AgentChatEvent,
  SendAgentChatMessageRequest,
} from "@podo/contracts"

import {
  agentChatTransportFailure,
  agentChatTransportFailureKind,
} from "./agent-chat-transport"

const maxRequestBytes = 16_384
const allowedCoreErrors = new Set([
  "agent_chat_not_configured",
  "agent_unavailable",
  "chat_failed",
  "chat_history_limit",
  "chat_turn_in_progress",
  "client_request_conflict",
  "codex_version_mismatch",
  "event_replay_expired",
  "invalid_event_id",
  "not_found",
])

type JsonResult =
  { ok: true; value: unknown } | { ok: false; response: Response }

export function agentSurfaceUnavailable(): Response | null {
  return process.env.PODO_DASHBOARD_MODE === "demo"
    ? null
    : Response.json({ error: "not_found" }, { status: 404 })
}

export async function readBoundedJson(request: Request): Promise<JsonResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    await request.body?.cancel("request_too_large")
    return {
      ok: false,
      response: Response.json({ error: "request_too_large" }, { status: 413 }),
    }
  }

  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxRequestBytes) {
        await reader.cancel("request_too_large")
        return {
          ok: false,
          response: Response.json(
            { error: "request_too_large" },
            { status: 413 },
          ),
        }
      }
      chunks.push(value)
    }
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown,
    }
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "invalid_request" }, { status: 400 }),
    }
  }
}

export function isEmptyObject(value: unknown): value is Record<string, never> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
}

export function isAgentMessage(
  value: unknown,
): value is SendAgentChatMessageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    Object.keys(input).length === 2 &&
    typeof input.content === "string" &&
    input.content.length > 0 &&
    input.content.length <= 8_000 &&
    input.content === input.content.trim() &&
    typeof input.clientRequestId === "string" &&
    input.clientRequestId.length > 0 &&
    input.clientRequestId.length <= 128 &&
    input.clientRequestId === input.clientRequestId.trim()
  )
}

export function safeAgentError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ""
  const match = message.match(/^Podo request failed \((\d{3})\):\s*(.*)$/s)
  if (!match)
    return Response.json({ error: "agent_unavailable" }, { status: 503 })

  const upstreamStatus = Number(match[1])
  let code = "agent_unavailable"
  try {
    const detail = JSON.parse(match[2] ?? "") as { error?: unknown }
    if (typeof detail.error === "string" && allowedCoreErrors.has(detail.error))
      code = detail.error
  } catch {
    // Never expose raw upstream bodies to the browser.
  }

  const status =
    upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 503
  return Response.json({ error: code }, { status })
}

export function parseAfterSequence(request: Request): number | Response {
  const url = new URL(request.url)
  const raw =
    request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0"
  const after = Number(raw)
  return Number.isSafeInteger(after) && after >= 0
    ? after
    : Response.json({ error: "invalid_event_id" }, { status: 400 })
}

export function agentEventStream(
  request: Request,
  client: PodoAgentChatClient,
  id: string,
  afterSequence: number,
): Response {
  const encoder = new TextEncoder()
  const upstreamAbort = new AbortController()
  const abortUpstream = () => upstreamAbort.abort()
  request.signal.addEventListener("abort", abortUpstream, { once: true })
  if (request.signal.aborted) abortUpstream()

  const events = client.subscribeAgentChatEvents(id, {
    afterSequence,
    signal: upstreamAbort.signal,
  })
  const iterator = events[Symbol.asyncIterator]()
  let finalized = false

  const finalize = async () => {
    if (finalized) return
    finalized = true
    request.signal.removeEventListener("abort", abortUpstream)
    upstreamAbort.abort()
    try {
      await iterator.return?.()
    } catch {
      // Cleanup is best-effort; never turn an upstream failure into a raw stream error.
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next()
        if (result.done) {
          await finalize()
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(toSse(result.value)))
      } catch {
        await finalize()
        controller.enqueue(encoder.encode(toTransportFailureSse()))
        controller.close()
      }
    },
    async cancel() {
      await finalize()
    },
  })

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  })
}

function toSse(event: AgentChatEvent): string {
  return `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

function toTransportFailureSse(): string {
  return `event: ${agentChatTransportFailureKind}\ndata: ${JSON.stringify(agentChatTransportFailure())}\n\n`
}
