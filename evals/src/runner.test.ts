import { describe, expect, test } from "bun:test"
import { parseDecisionDocument } from "./runner"

describe("decision document parser", () => {
  test("rejects malformed candidate output before scoring", () => {
    expect(() =>
      parseDecisionDocument({
        schemaVersion: 1,
        metadata: {
          model: null,
          promptVersion: null,
          codexVersion: null,
          protocolHash: null,
          durationMs: null,
          inputTokens: null,
          outputTokens: null,
          toolCalls: null,
        },
        decisions: [{ mode: "auto_fix" }],
      }),
    ).toThrow("decisions[0]")
  })
})
