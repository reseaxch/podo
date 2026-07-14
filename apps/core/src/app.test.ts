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

  test("reads and atomically updates core-owned settings", async () => {
    const handler = createCoreHandler()

    const initial = await handler(new Request("http://rootline.test/api/settings"))
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({
      settings: {
        autonomyMode: "observe",
        monitoringEnabled: true,
        defaultSandbox: "read-only",
        turnTimeoutMs: 60_000,
      },
    })

    const updated = await handler(new Request("http://rootline.test/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autonomyMode: "act_with_approval", turnTimeoutMs: 90_000 }),
    }))
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      settings: { autonomyMode: "act_with_approval", turnTimeoutMs: 90_000 },
    })
  })

  test("rejects an invalid settings patch without partially applying it", async () => {
    const handler = createCoreHandler()
    const invalid = await handler(new Request("http://rootline.test/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monitoringEnabled: false, defaultSandbox: "danger-full-access" }),
    }))

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: "invalid_settings" })
    const current = await handler(new Request("http://rootline.test/api/settings"))
    expect(await current.json()).toMatchObject({
      settings: { monitoringEnabled: true, defaultSandbox: "read-only" },
    })
  })

  test("rejects empty, unknown, and out-of-range settings patches", async () => {
    const handler = createCoreHandler()
    for (const body of [
      {},
      { unexpected: true },
      { turnTimeoutMs: 999 },
      { turnTimeoutMs: 3_600_001 },
      { monitoringEnabled: "false" },
    ]) {
      const response = await handler(new Request("http://rootline.test/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }))
      expect(response.status).toBe(400)
    }
  })
})
