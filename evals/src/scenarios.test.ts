import { describe, expect, test } from "bun:test"
import { loadScenarios } from "./scenarios"

describe("scenario corpus", () => {
  test("contains the canonical demo and safety controls", async () => {
    const scenarios = await loadScenarios()
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "cache-growth",
      "failing-remediation",
      "healthy-control",
      "insufficient-evidence",
      "misleading-deployment",
    ])
  })
})
