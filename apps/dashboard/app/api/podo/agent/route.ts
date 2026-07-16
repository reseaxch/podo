import type { Investigation, InvestigationEvent } from "@podo/contracts"
import { NextResponse } from "next/server"

import {
  createDashboardClient,
  incidentWorkingDirectory,
} from "../../../lib/dashboard-client"

type AgentTurnRequest = {
  prompt?: string
  preview?: boolean
  context?: {
    label?: string
    path?: string
  }
  history?: Array<{
    role?: "user" | "assistant"
    text?: string
  }>
}

type AgentStreamPacket =
  | { type: "session"; investigationId: string }
  | { type: "progress"; stage: number }
  | { type: "event"; event: InvestigationEvent }
  | { type: "error"; message: string }

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : ""
}

function buildPrompt(input: AgentTurnRequest): string {
  const prompt = cleanText(input.prompt, 4_000)
  const projectLabel = cleanText(input.context?.label, 120) || "podo-cloud"
  const projectScope =
    cleanText(input.context?.path, 240) || "All project evidence"
  const history = (input.history ?? [])
    .slice(-8)
    .map((message) => {
      const role = message.role === "assistant" ? "Podo Agent" : "Operator"
      const text = cleanText(message.text, 1_500)
      return text ? `${role}: ${text}` : ""
    })
    .filter(Boolean)
    .join("\n\n")

  return [
    "You are Podo Agent, an evidence-first incident investigation assistant.",
    "This turn is read-only. Be concise, state uncertainty plainly, and cite concrete evidence IDs or repository paths whenever available.",
    "Do not claim a production action was taken. If the operator asks for mutation, explain the bounded next step and its required approval.",
    `Investigation scope: the entire ${projectLabel} project (${projectScope}).`,
    "Search across incidents, services, metrics, traces, deployments, commits, and repository code. The open dashboard page is only an interface location and must not restrict the investigation.",
    history ? `Recent conversation:\n${history}` : "",
    `Operator request:\n${prompt}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function packetLine(packet: AgentStreamPacket): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(packet)}\n`)
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function streamedResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  })
}

function previewResponse(projectLabel: string): string {
  return [
    `I checked the ${projectLabel} project and traced the strongest active signal across its available evidence.`,
    "",
    "The likely causal chain is:",
    "checkout-service heap pressure -> deploy v1.8.4 -> commit 8f3a2c1 -> session-cache.ts:47",
    "",
    "Evidence checked:",
    "- Memory reached 91% after the latest deployment.",
    "- Error rate rose to 8.7% while p95 latency reached 1.82s.",
    "- The system graph links the regression to unbounded cache retention with 96% confidence.",
    "",
    "Recommended next step:",
    "Open INC-042 and review the cited traces before approving a bounded cache remediation. No changes were made.",
  ].join("\n")
}

function mockAgentStream(input: AgentTurnRequest) {
  const investigationId = "investigation_preview"
  const answer = previewResponse(
    cleanText(input.context?.label, 120) || "podo-cloud",
  )
  const chunks = answer.match(/.{1,68}(?:\s|$)/g) ?? [answer]

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let sequence = 0
      const send = (packet: AgentStreamPacket) =>
        controller.enqueue(packetLine(packet))
      const event = (
        data: Omit<
          InvestigationEvent,
          "investigationId" | "sequence" | "timestamp"
        >,
      ) =>
        send({
          type: "event",
          event: {
            ...data,
            investigationId,
            sequence: (sequence += 1),
            timestamp: new Date().toISOString(),
          } as InvestigationEvent,
        })

      send({ type: "session", investigationId })
      send({ type: "progress", stage: 0 })
      event({ kind: "investigation.running", payload: { status: "running" } })
      await wait(650)
      send({ type: "progress", stage: 1 })
      await wait(750)
      send({ type: "progress", stage: 2 })
      await wait(750)
      send({ type: "progress", stage: 3 })
      await wait(650)
      for (const chunk of chunks) {
        event({ kind: "output.delta", payload: { text: chunk } })
        await wait(85)
      }
      event({
        kind: "investigation.completed",
        payload: { status: "completed" },
      })
      controller.close()
    },
  })
}

export async function POST(request: Request) {
  const input = (await request.json()) as AgentTurnRequest
  const prompt = cleanText(input.prompt, 4_000)
  if (!prompt)
    return NextResponse.json(
      { error: "invalid_prompt", message: "A message is required" },
      { status: 400 },
    )

  if (input.preview) return streamedResponse(mockAgentStream(input))

  const client = createDashboardClient()
  let investigation: Investigation
  try {
    const result = await client.startInvestigation({
      prompt: buildPrompt(input),
      cwd: incidentWorkingDirectory(),
      sandbox: "read-only",
    })
    investigation = result.investigation
  } catch {
    return NextResponse.json(
      {
        error: "core_unavailable",
        message:
          "Podo Core is unavailable. Start the Core service to chat with the agent.",
      },
      { status: 503 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (packet: AgentStreamPacket) =>
        controller.enqueue(packetLine(packet))

      try {
        send({ type: "session", investigationId: investigation.id })
        send({ type: "progress", stage: 0 })
        let outputDeltaCount = 0
        for await (const event of client.subscribeEvents(investigation.id, {
          signal: request.signal,
        })) {
          if (event.kind === "investigation.running")
            send({ type: "progress", stage: 1 })
          if (event.kind === "output.delta") {
            outputDeltaCount += 1
            send({
              type: "progress",
              stage: outputDeltaCount === 1 ? 2 : 3,
            })
          }
          if (event.kind === "investigation.completed")
            send({ type: "progress", stage: 3 })
          send({ type: "event", event })
        }
      } catch (error) {
        if (!request.signal.aborted)
          send({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "The agent stream ended unexpectedly",
          })
      } finally {
        controller.close()
      }
    },
  })

  return streamedResponse(stream)
}
