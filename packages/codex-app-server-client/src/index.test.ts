import { describe, expect, test } from "bun:test"
import { parseCodexVersion } from "./index"

describe("parseCodexVersion", () => {
  test("parses the Codex CLI version", () => {
    expect(parseCodexVersion("codex-cli 0.144.1\n")).toBe("0.144.1")
  })

  test("rejects unrecognized output", () => {
    expect(() => parseCodexVersion("unknown")).toThrow("Unable to parse Codex version")
  })
})
