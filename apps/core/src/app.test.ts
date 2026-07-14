import { describe, expect, test } from "bun:test"
import { createCoreHandler } from "./app"

describe("Rootline core handler", () => {
  test("reports process health without requiring Codex", async () => {
    const handler = createCoreHandler({
      inspectCodex: async () => {
        throw new Error("health must not inspect Codex")
      },
    })

    const response = await handler(new Request("http://rootline.test/healthz"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      service: "rootline-core",
      status: "ok",
      version: "0.0.0",
    })
  })

  test("reports Codex readiness through the system contract", async () => {
    const handler = createCoreHandler({
      inspectCodex: async () => ({
        binary: "codex",
        version: "0.144.1",
        rawVersion: "codex-cli 0.144.1",
      }),
    })

    const response = await handler(new Request("http://rootline.test/readyz"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "ready",
      codex: {
        available: true,
        transport: "stdio",
        version: "0.144.1",
      },
    })
  })

  test("does not claim readiness when Codex is unavailable", async () => {
    const handler = createCoreHandler({
      inspectCodex: async () => {
        throw new Error("codex not found")
      },
    })

    const response = await handler(new Request("http://rootline.test/readyz"))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: "degraded",
      codex: {
        available: false,
        error: "codex not found",
      },
    })
  })
})
