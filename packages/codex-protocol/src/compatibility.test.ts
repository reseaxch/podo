import { describe, expect, test } from "bun:test"
import { assertProtocolCompatibility } from "./compatibility"

describe("assertProtocolCompatibility", () => {
  test("accepts a binary matching the pinned Rust tag", () => {
    expect(assertProtocolCompatibility("codex-cli 0.144.5", "rust-v0.144.5")).toBe("0.144.5")
  })

  test("rejects protocol generation from a different binary", () => {
    expect(() => assertProtocolCompatibility("codex-cli 0.142.0", "rust-v0.144.5")).toThrow(
      "does not match pinned upstream",
    )
  })
})
