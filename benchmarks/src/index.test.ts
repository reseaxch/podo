import { describe, expect, test } from "bun:test"
import { measure } from "./index"

describe("measure", () => {
  test("records an operation result and a non-negative duration", async () => {
    const sample = await measure("constant", async () => 42)
    expect(sample.result).toBe(42)
    expect(sample.durationMs).toBeGreaterThanOrEqual(0)
  })
})
