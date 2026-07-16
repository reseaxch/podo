import type { AgentChatEvent } from "@podo/contracts"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { agentChatTransportFailure } from "../../lib/agent-chat-transport"
import { AgentPanel } from "./agent-panel"

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("AgentPanel", () => {
  it("uses only the Core-owned chat, message, and event contract", async () => {
    const user = userEvent.setup()
    const fetch = mockAgentTurn([
      event(2, { kind: "message.accepted", payload: { message: userMessage } }),
      event(3, {
        kind: "output.delta",
        payload: { text: "Heap growth is the strongest active signal." },
      }),
      event(4, {
        kind: "message.completed",
        payload: {
          message: {
            id: "assistant-1",
            role: "assistant",
            content: "Heap growth is the strongest active signal.",
            createdAt: timestamp,
          },
        },
      }),
    ])

    renderPanel()
    expect(screen.getByText("Read-only")).toBeInTheDocument()
    expect(screen.queryByText(/Approval required/i)).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Trace the strongest evidence" }),
    )

    expect(
      await screen.findByText("Heap growth is the strongest active signal."),
    ).toBeInTheDocument()
    const messageCall = fetch.mock.calls.find(([url]) =>
      String(url).endsWith("/messages"),
    )
    expect(messageCall).toBeDefined()
    const body = JSON.parse(
      String((messageCall?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["clientRequestId", "content"])
    expect(body.content).toBe("Trace the strongest evidence")
    expect(fetch).toHaveBeenCalledWith(
      "/api/podo/agent/readiness",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("restores completed local display history and clears the server chat", async () => {
    const user = userEvent.setup()
    mockAgentTurn([
      event(2, { kind: "message.accepted", payload: { message: userMessage } }),
      event(3, {
        kind: "message.completed",
        payload: {
          message: {
            id: "assistant-history",
            role: "assistant",
            content: "This answer should survive closing the panel.",
            createdAt: timestamp,
          },
        },
      }),
    ])

    const first = renderPanel()
    await user.click(
      screen.getByRole("button", { name: "What should I review next?" }),
    )
    expect(
      await screen.findByText("This answer should survive closing the panel."),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        window.localStorage.getItem("podo-agent-history-v1:podo-cloud"),
      ).toContain("This answer should survive closing the panel."),
    )

    first.unmount()
    renderPanel()
    expect(
      await screen.findByText("This answer should survive closing the panel."),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear chat" }))
    expect(
      screen.getByText("Investigate across the project"),
    ).toBeInTheDocument()
    expect(
      window.localStorage.getItem("podo-agent-history-v1:podo-cloud"),
    ).toBeNull()
  })

  it("shows the evidence-oriented thinking state while readiness is pending", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => undefined),
    )
    renderPanel()

    await user.type(screen.getByLabelText("Message Podo"), "Explain the risk")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(screen.getByRole("status")).toHaveTextContent(
      "Mapping project scope",
    )
    expect(screen.getByRole("status")).toHaveTextContent("1 of 4")
  })

  it("fails closed when the demo agent boundary is unavailable", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "not_found" }, { status: 404 }),
    )
    renderPanel()

    await user.click(
      screen.getByRole("button", { name: "Summarize what needs attention" }),
    )

    expect(
      await screen.findByText(
        "Podo Agent is available only in the demo workspace.",
      ),
    ).toBeInTheDocument()
  })

  it("distinguishes a typed transport failure from normal stream completion", async () => {
    const user = userEvent.setup()
    const partial = event(2, {
      kind: "output.delta",
      payload: { text: "Partial evidence was received." },
    })
    mockAgentTurn([], {
      stream: textStream(
        `id: ${partial.sequence}\nevent: ${partial.kind}\ndata: ${JSON.stringify(partial)}\n\n` +
          `event: transport.failed\ndata: ${JSON.stringify(agentChatTransportFailure())}\n\n`,
      ),
    })
    renderPanel()

    await user.click(
      screen.getByRole("button", { name: "Summarize what needs attention" }),
    )

    expect(
      await screen.findByText("Partial evidence was received."),
    ).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(
      screen.queryByText(
        "The investigation completed without a written response.",
      ),
    ).not.toBeInTheDocument()
  })

  it("cancels the Core-owned turn and exposes no approval action", async () => {
    const user = userEvent.setup()
    let streamController:
      ReadableStreamDefaultController<Uint8Array> | undefined
    const fetch = mockAgentTurn([], {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
        },
      }),
    })
    renderPanel()

    await user.click(
      screen.getByRole("button", { name: "Summarize what needs attention" }),
    )
    await screen.findByRole("button", { name: "Stop" })
    await user.click(screen.getByRole("button", { name: "Stop" }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/podo/agent/chats/chat-1/turn",
        expect.objectContaining({ method: "DELETE" }),
      ),
    )
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument()
    streamController?.close()
  })

  it("renders a structured read-only result with evidence actions", async () => {
    const user = userEvent.setup()
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    })
    const answer = [
      "I checked podo-cloud and traced the strongest active signal.",
      "The likely causal chain is:",
      "checkout-service -> deploy v1.8.4 -> commit 8f3a2c1 -> session-cache.ts:47",
      "Evidence checked:",
      "- Memory reached 91% after the latest deployment.",
      "- The system graph links the regression with 96% confidence.",
      "Recommended next step:",
      "Open INC-042 and review the cited traces. No changes were made.",
    ].join("\n")
    mockAgentTurn([
      event(2, { kind: "output.delta", payload: { text: answer } }),
      event(3, {
        kind: "message.completed",
        payload: {
          message: {
            id: "assistant-structured",
            role: "assistant",
            content: answer,
            createdAt: timestamp,
          },
        },
      }),
    ])
    renderPanel()

    await user.click(
      screen.getByRole("button", { name: "Trace the strongest evidence" }),
    )

    const result = await screen.findByRole("region", {
      name: "Investigation result",
    })
    expect(result).toHaveTextContent("Causal path")
    expect(result).toHaveTextContent("2 sources checked")
    expect(screen.getByRole("link", { name: /Open INC-042/ })).toHaveAttribute(
      "href",
      "/?incident=INC-042&tab=evidence",
    )

    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(copy).toHaveBeenCalledWith(answer)
  })
})

const timestamp = "2026-07-16T00:00:00.000Z"
const userMessage = {
  id: "user-core",
  role: "user" as const,
  content: "question",
  clientRequestId: "request-1",
  createdAt: timestamp,
}

function renderPanel() {
  return render(
    <AgentPanel
      onClose={vi.fn()}
      projectLabel="podo-cloud"
      projectScope="All project evidence"
    />,
  )
}

function event(
  sequence: number,
  input: Omit<AgentChatEvent, "chatId" | "sequence" | "timestamp">,
): AgentChatEvent {
  return {
    ...input,
    chatId: "chat-1",
    sequence,
    timestamp,
  } as AgentChatEvent
}

function sseResponse(events: AgentChatEvent[]) {
  return new Response(
    events
      .map(
        (item) =>
          `id: ${item.sequence}\nevent: ${item.kind}\ndata: ${JSON.stringify(item)}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  )
}

function textStream(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}

function mockAgentTurn(
  events: AgentChatEvent[],
  options: { stream?: ReadableStream<Uint8Array> } = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input)
    if (url.endsWith("/readiness"))
      return Promise.resolve(
        Response.json({
          service: "podo-core",
          status: "ready",
          version: "0.0.0",
          chat: { configured: true, available: true, sandbox: "read-only" },
        }),
      )
    if (url.endsWith("/chats") && init?.method === "POST")
      return Promise.resolve(
        Response.json({
          chat: {
            id: "chat-1",
            status: "ready",
            createdAt: timestamp,
            updatedAt: timestamp,
            lastSequence: 1,
            messages: [],
          },
        }),
      )
    if (url.endsWith("/messages"))
      return Promise.resolve(Response.json({ accepted: true }))
    if (url.includes("/events"))
      return Promise.resolve(
        options.stream
          ? new Response(options.stream, {
              headers: { "content-type": "text/event-stream" },
            })
          : sseResponse(events),
      )
    if (url.endsWith("/turn") && init?.method === "DELETE")
      return Promise.resolve(Response.json({ chat: { id: "chat-1" } }))
    return Promise.resolve(
      Response.json({ error: "unexpected_request" }, { status: 500 }),
    )
  })
}
