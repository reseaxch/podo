import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentPanel } from "./agent-panel"

function agentResponse(...packets: unknown[]) {
  return new Response(
    `${packets.map((packet) => JSON.stringify(packet)).join("\n")}\n`,
    {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("AgentPanel", () => {
  it("restores completed chat history and lets the operator clear it", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      agentResponse(
        {
          type: "event",
          event: {
            investigationId: "investigation_history",
            sequence: 1,
            timestamp: "2026-07-15T00:00:00.000Z",
            kind: "output.delta",
            payload: { text: "This answer should survive closing the chat." },
          },
        },
        {
          type: "event",
          event: {
            investigationId: "investigation_history",
            sequence: 2,
            timestamp: "2026-07-15T00:00:01.000Z",
            kind: "investigation.completed",
            payload: { status: "completed" },
          },
        },
      ),
    )

    const firstPanel = render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled()

    await user.click(
      screen.getByRole("button", { name: "What should I review next?" }),
    )
    expect(
      await screen.findByText("This answer should survive closing the chat."),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        window.localStorage.getItem("podo-agent-history-v1:podo-cloud"),
      ).toContain("This answer should survive closing the chat."),
    )

    firstPanel.unmount()
    render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )

    expect(
      await screen.findByText("This answer should survive closing the chat."),
    ).toBeInTheDocument()
    expect(screen.getByText("What should I review next?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear chat" }))
    expect(
      screen.getByText("Investigate across the project"),
    ).toBeInTheDocument()
    expect(
      window.localStorage.getItem("podo-agent-history-v1:podo-cloud"),
    ).toBeNull()
  })

  it("streams a read-only investigation answer from a suggested prompt", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      agentResponse(
        { type: "session", investigationId: "investigation_1" },
        {
          type: "event",
          event: {
            investigationId: "investigation_1",
            sequence: 1,
            timestamp: "2026-07-15T00:00:00.000Z",
            kind: "output.delta",
            payload: { text: "Heap growth is the strongest active signal." },
          },
        },
        {
          type: "event",
          event: {
            investigationId: "investigation_1",
            sequence: 2,
            timestamp: "2026-07-15T00:00:01.000Z",
            kind: "investigation.completed",
            payload: { status: "completed" },
          },
        },
      ),
    )

    render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )

    expect(screen.getByText("Read-only")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Trace the strongest evidence" }),
    )

    expect(screen.getByText("Trace the strongest evidence")).toBeInTheDocument()
    expect(
      await screen.findByText("Heap growth is the strongest active signal."),
    ).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/podo/agent",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("shows the evidence-oriented thinking state while the request starts", async () => {
    const user = userEvent.setup()
    let resolveRequest: ((response: Response) => void) | undefined
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
        }),
    )

    render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )

    await user.type(screen.getByLabelText("Message Podo"), "Explain the risk")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(screen.getByRole("status")).toHaveTextContent(
      "Mapping project scope",
    )
    expect(screen.getByRole("status")).toHaveTextContent("1 of 4")
    expect(screen.getByRole("status")).toHaveTextContent("In progress")

    resolveRequest?.(
      agentResponse({ type: "session", investigationId: "investigation_2" }),
    )
    await waitFor(() =>
      expect(
        screen.getByText(
          "The investigation completed without a written response.",
        ),
      ).toBeInTheDocument(),
    )
  })

  it("keeps streamed draft text hidden until the response is complete", async () => {
    const user = userEvent.setup()
    const encoder = new TextEncoder()
    let streamController:
      ReadableStreamDefaultController<Uint8Array> | undefined
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
        },
      }),
    )
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response)

    render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "Summarize what needs attention" }),
    )
    streamController?.enqueue(
      encoder.encode(
        `${JSON.stringify({
          type: "event",
          event: {
            investigationId: "investigation_stream",
            sequence: 1,
            timestamp: "2026-07-15T00:00:00.000Z",
            kind: "output.delta",
            payload: { text: "Partial raw stream" },
          },
        })}\n`,
      ),
    )

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument())
    expect(screen.queryByText("Partial raw stream")).not.toBeInTheDocument()

    streamController?.enqueue(
      encoder.encode(
        `${JSON.stringify({
          type: "event",
          event: {
            investigationId: "investigation_stream",
            sequence: 2,
            timestamp: "2026-07-15T00:00:01.000Z",
            kind: "investigation.completed",
            payload: { status: "completed" },
          },
        })}\n`,
      ),
    )
    streamController?.close()

    expect(await screen.findByText("Partial raw stream")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("shows a clear inline message when Podo Core is unavailable", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "core_unavailable",
          message:
            "Podo Core is unavailable. Start the Core service to chat with the agent.",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      ),
    )

    render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "Summarize what needs attention" }),
    )

    expect(
      await screen.findByText(
        "Podo Core is unavailable. Start the Core service to chat with the agent.",
      ),
    ).toBeInTheDocument()
  })

  it("renders a structured result with evidence actions", async () => {
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
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        agentResponse(
          { type: "session", investigationId: "investigation_3" },
          { type: "progress", stage: 3 },
          {
            type: "event",
            event: {
              investigationId: "investigation_3",
              sequence: 1,
              timestamp: "2026-07-15T00:00:00.000Z",
              kind: "output.delta",
              payload: { text: answer },
            },
          },
          {
            type: "event",
            event: {
              investigationId: "investigation_3",
              sequence: 2,
              timestamp: "2026-07-15T00:00:01.000Z",
              kind: "investigation.completed",
              payload: { status: "completed" },
            },
          },
        ),
      ),
    )

    render(
      <AgentPanel
        onClose={vi.fn()}
        projectLabel="podo-cloud"
        projectScope="All project evidence"
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "Trace the strongest evidence" }),
    )

    const result = await screen.findByRole("region", {
      name: "Investigation result",
    })
    expect(result).toHaveTextContent("Causal path")
    expect(result).toHaveTextContent("Memory reached 91%")
    expect(result).toHaveTextContent("2 sources checked")
    expect(result).toHaveTextContent("Read-only")
    expect(
      screen.getByRole("link", {
        name: /Open evidence: Memory reached 91%/,
      }),
    ).toHaveAttribute("href", "/?incident=INC-042&tab=evidence")
    expect(
      screen.getByRole("link", {
        name: /Open evidence: The system graph links/,
      }),
    ).toHaveAttribute("href", "/?incident=INC-042&tab=graph")
    expect(screen.getByRole("link", { name: /Open INC-042/ })).toHaveAttribute(
      "href",
      "/?incident=INC-042&tab=evidence",
    )

    await user.click(screen.getByRole("button", { name: "Collapse answer" }))
    expect(screen.queryByText("Causal path")).not.toBeInTheDocument()
    expect(screen.getByText("2 sources checked")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Expand answer" }))
    expect(screen.getByText("Causal path")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(copy).toHaveBeenCalledWith(answer)
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
  })
})
