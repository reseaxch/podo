import { describe, expect, test } from "bun:test"
import { assertCodexRuntimeCompatibility, parseCodexVersion } from "./index"

describe("parseCodexVersion", () => {
  test("parses the Codex CLI version", () => {
    expect(parseCodexVersion("codex-cli 0.144.1\n")).toBe("0.144.1")
  })

  test("rejects unrecognized output", () => {
    expect(() => parseCodexVersion("unknown")).toThrow("Unable to parse Codex version")
  })

  test("rejects a runtime that does not match the generated protocol", () => {
    expect(() => assertCodexRuntimeCompatibility({
      binary: "codex",
      version: "0.142.0",
      rawVersion: "codex-cli 0.142.0",
    })).toThrow("does not match pinned upstream")
    expect(assertCodexRuntimeCompatibility({
      binary: "codex",
      version: "0.144.1",
      rawVersion: "codex-cli 0.144.1",
    })).toBe("0.144.1")
  })
})
