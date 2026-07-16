import type { PodoAgentChatClient } from "@podo/client"
import type { AgentChat, AgentChatEvent } from "@podo/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const client = vi.hoisted(() => ({
  agentReadiness: vi.fn(),
  cancelAgentChatTurn: vi.fn(),
  createAgentChat: vi.fn(),
  getAgentChat: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  subscribeAgentChatEvents: vi.fn(),
}))

vi.mock("../../../lib/dashboard-client", () => ({
  createDashboardClient: () => client as unknown as PodoAgentChatClient,
}))

import { POST as createChat } from "./chats/route"
import { GET as streamEvents } from "./chats/[id]/events/route"
import { POST as sendMessage } from "./chats/[id]/messages/route"
import * as turnRoute from "./chats/[id]/turn/route"
import { GET as readiness } from "./readiness/route"

const chat: AgentChat = {
  id: "chat-1",
  status: "ready",
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  lastSequence: 0,
  messages: [],
}

const context = { params: Promise.resolve({ id: chat.id }) }

describe("dashboard agent chat routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PODO_DASHBOARD_MODE = "demo"
    client.agentReadiness.mockResolvedValue({
      service: "podo-core",
      status: "ready",
      version: "0.0.0",
      chat: { configured: true, available: true, sandbox: "read-only" },
    })
    client.createAgentChat.mockResolvedValue({ chat })
    client.cancelAgentChatTurn.mockResolvedValue({ chat })
  })

  afterEach(() => {
    delete process.env.PODO_DASHBOARD_MODE
  })

  it("keeps agent capacity unreachable outside the server-owned demo boundary", async () => {
    process.env.PODO_DASHBOARD_MODE = "live"

    const response = await readiness()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not_found" })
    expect(client.agentReadiness).not.toHaveBeenCalled()
  })

  it("creates chats without accepting caller-authored configuration", async () => {
    const injected = await createChat(
      jsonRequest("http://dashboard.test/api/podo/agent/chats", {
        approvalPolicy: "never",
      }),
    )
    expect(injected.status).toBe(400)
    expect(client.createAgentChat).not.toHaveBeenCalled()

    const response = await createChat(
      jsonRequest("http://dashboard.test/api/podo/agent/chats", {}),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ chat })
    expect(client.createAgentChat).toHaveBeenCalledOnce()
  })

  it("rejects malformed and oversized request bodies before Core", async () => {
    const malformed = await createChat(
      new Request("http://dashboard.test/api/podo/agent/chats", {
        method: "POST",
        body: "{",
      }),
    )
    expect(malformed.status).toBe(400)

    const oversized = await sendMessage(
      new Request(
        "http://dashboard.test/api/podo/agent/chats/chat-1/messages",
        { method: "POST", body: "x".repeat(16_385) },
      ),
      context,
    )
    expect(oversized.status).toBe(413)
    expect(client.sendAgentChatMessage).not.toHaveBeenCalled()
  })

  it("stops consuming a chunked body as soon as the byte limit is exceeded", async () => {
    let pulls = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(4_096))
      },
      cancel() {
        cancelled = true
      },
    })

    const response = await createChat(
      new Request("http://dashboard.test/api/podo/agent/chats", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
    )

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThanOrEqual(6)
    expect(client.createAgentChat).not.toHaveBeenCalled()
  })

  it("forwards only content and an idempotent client request id", async () => {
    client.sendAgentChatMessage
      .mockResolvedValueOnce({ chat, accepted: true })
      .mockResolvedValueOnce({ chat, accepted: false })
    const input = { content: "What changed?", clientRequestId: "request-1" }

    const first = await sendMessage(
      jsonRequest(
        "http://dashboard.test/api/podo/agent/chats/chat-1/messages",
        input,
      ),
      context,
    )
    const duplicate = await sendMessage(
      jsonRequest(
        "http://dashboard.test/api/podo/agent/chats/chat-1/messages",
        input,
      ),
      context,
    )

    expect(first.status).toBe(202)
    expect(duplicate.status).toBe(200)
    expect(client.sendAgentChatMessage).toHaveBeenNthCalledWith(
      1,
      chat.id,
      input,
    )
    expect(client.sendAgentChatMessage).toHaveBeenNthCalledWith(
      2,
      chat.id,
      input,
    )

    const approvalInjection = await sendMessage(
      jsonRequest(
        "http://dashboard.test/api/podo/agent/chats/chat-1/messages",
        { ...input, approval: "approved" },
      ),
      context,
    )
    expect(approvalInjection.status).toBe(400)
  })

  it("offers cancellation but no approval operation", async () => {
    const response = await turnRoute.DELETE(
      new Request("http://dashboard.test/api/podo/agent/chats/chat-1/turn", {
        method: "DELETE",
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(client.cancelAgentChatTurn).toHaveBeenCalledWith(chat.id)
    expect("POST" in turnRoute).toBe(false)
  })

  it("aborts the upstream event subscription when the browser disconnects", async () => {
    let upstreamSignal: AbortSignal | undefined
    client.subscribeAgentChatEvents.mockImplementation(
      (_id: string, options: { signal?: AbortSignal }) => {
        upstreamSignal = options.signal
        return eventStream([
          event({
            kind: "chat.started",
            payload: { status: "ready" },
          }),
        ])
      },
    )

    const response = await streamEvents(
      new Request("http://dashboard.test/api/podo/agent/chats/chat-1/events"),
      context,
    )
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()

    expect(upstreamSignal?.aborted).toBe(true)
  })

  it("passes an aborted signal upstream when the browser was already disconnected", async () => {
    let upstreamSignal: AbortSignal | undefined
    let abortedAtSubscription = false
    client.subscribeAgentChatEvents.mockImplementation(
      (_id: string, options: { signal?: AbortSignal }) => {
        upstreamSignal = options.signal
        abortedAtSubscription = options.signal?.aborted ?? false
        return eventStream([])
      },
    )
    const downstream = new AbortController()
    downstream.abort()

    const response = await streamEvents(
      new Request("http://dashboard.test/api/podo/agent/chats/chat-1/events", {
        signal: downstream.signal,
      }),
      context,
    )
    await response.text()

    expect(abortedAtSubscription).toBe(true)
    expect(upstreamSignal?.aborted).toBe(true)
  })

  it("aborts and returns the iterator when the upstream stream fails", async () => {
    let upstreamSignal: AbortSignal | undefined
    let returned = false
    const iterator: AsyncIterator<AgentChatEvent> = {
      next: vi.fn().mockRejectedValue(new Error("invalid chat id")),
      return: vi.fn(async () => {
        returned = true
        return {
          done: true,
          value: undefined,
        } as IteratorResult<AgentChatEvent>
      }),
    }
    client.subscribeAgentChatEvents.mockImplementation(
      (_id: string, options: { signal?: AbortSignal }) => {
        upstreamSignal = options.signal
        return { [Symbol.asyncIterator]: () => iterator }
      },
    )

    const response = await streamEvents(
      new Request("http://dashboard.test/api/podo/agent/chats/missing/events"),
      { params: Promise.resolve({ id: "missing" }) },
    )
    const body = await response.text()

    expect(body).toBe("")
    expect(body).not.toContain("proxy.error")
    expect(upstreamSignal?.aborted).toBe(true)
    expect(returned).toBe(true)
    expect(iterator.return).toHaveBeenCalledOnce()
  })

  it("forwards bounded failed-turn events without exposing upstream exceptions", async () => {
    client.subscribeAgentChatEvents.mockReturnValue(
      eventStream([
        event({ kind: "output.delta", payload: { text: "partial" } }),
        event({
          kind: "chat.failed",
          payload: {
            status: "failed",
            error: { code: "turn_failed", message: "The turn failed" },
          },
        }),
      ]),
    )

    const response = await streamEvents(
      new Request(
        "http://dashboard.test/api/podo/agent/chats/chat-1/events?after=0",
      ),
      context,
    )
    const body = await response.text()
    expect(body).toContain("event: output.delta")
    expect(body).toContain("event: chat.failed")

    client.sendAgentChatMessage.mockRejectedValueOnce(
      new Error("Podo request failed (500): secret upstream stack"),
    )
    const failure = await sendMessage(
      jsonRequest(
        "http://dashboard.test/api/podo/agent/chats/chat-1/messages",
        { content: "status", clientRequestId: "request-error" },
      ),
      context,
    )
    expect(failure.status).toBe(503)
    expect(await failure.text()).toBe('{"error":"agent_unavailable"}')
  })
})

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function event(
  input: Omit<AgentChatEvent, "chatId" | "sequence" | "timestamp">,
): AgentChatEvent {
  return {
    ...input,
    chatId: chat.id,
    sequence: 1,
    timestamp: "2026-07-16T00:00:00.000Z",
  } as AgentChatEvent
}

async function* eventStream(events: AgentChatEvent[]) {
  for (const item of events) yield item
}
