import { describe, expect, test } from "bun:test"
import type { AgentChatAnswer, AgentChatMessage } from "./index"

describe("agent chat contracts", () => {
  test("carries one versioned structured answer on completed assistant messages", () => {
    const answer = {
      schemaVersion: "podo.agent-answer.v1",
      finding: "Heap pressure followed the latest deployment.",
      causalPath: ["checkout-service", "deploy v1.8.4", "session-cache.ts:47"],
      evidence: ["Memory reached 91% after the latest deployment."],
      recommendation: "Review the cited traces in INC-042.",
      safety: "No changes were made.",
      confidencePercent: 96,
      incidentId: "INC-042",
    } satisfies AgentChatAnswer
    const message = {
      id: "message-1",
      role: "assistant",
      content: "Canonical human-readable answer",
      createdAt: "2026-07-16T00:00:00.000Z",
      answer,
    } satisfies AgentChatMessage

    expect(message.answer.schemaVersion).toBe("podo.agent-answer.v1")
    expect(message.answer.confidencePercent).toBe(96)
  })
})
