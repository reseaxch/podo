import { describe, expect, test } from "bun:test"
import type { RootlineClient } from "@rootline/client"
import { runCli } from "./index"

const settings = {
  autonomyMode: "observe" as const,
  monitoringEnabled: true,
  defaultSandbox: "read-only" as const,
  turnTimeoutMs: 60_000,
}

function client(overrides: Partial<RootlineClient> = {}): RootlineClient {
  return {
    health: async () => ({ service: "rootline-core", status: "ok", version: "0.0.0" }),
    systemStatus: async () => { throw new Error("unused") },
    getSettings: async () => ({ settings }),
    updateSettings: async (patch) => ({ settings: { ...settings, ...patch } }),
    start: async () => { throw new Error("unused") },
    get: async () => { throw new Error("unused") },
    cancel: async () => { throw new Error("unused") },
    startInvestigation: async () => { throw new Error("unused") },
    getInvestigation: async () => { throw new Error("unused") },
    cancelInvestigation: async () => { throw new Error("unused") },
    approve: async () => { throw new Error("unused") },
    deny: async () => { throw new Error("unused") },
    subscribeEvents: () => { throw new Error("unused") },
    ...overrides,
  }
}

describe("Rootline CLI config", () => {
  test("prints settings as JSON", async () => {
    const stdout: string[] = []
    const exitCode = await runCli(["config", "show"], { client: client(), stdout: (line) => stdout.push(line) })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.join("\n"))).toEqual({ settings })
  })

  test("parses typed values before updating settings", async () => {
    const patches: unknown[] = []
    const stdout: string[] = []
    const fake = client({
      updateSettings: async (patch) => {
        patches.push(patch)
        return { settings: { ...settings, ...patch } }
      },
    })

    expect(await runCli(["config", "set", "monitoringEnabled", "false"], { client: fake, stdout: (line) => stdout.push(line) })).toBe(0)
    expect(await runCli(["config", "set", "turnTimeoutMs", "90000"], { client: fake, stdout: (line) => stdout.push(line) })).toBe(0)
    expect(patches).toEqual([{ monitoringEnabled: false }, { turnTimeoutMs: 90_000 }])
  })

  test("fails locally on invalid keys and values", async () => {
    let called = false
    const fake = client({ updateSettings: async () => { called = true; return { settings } } })
    const stderr: string[] = []

    expect(await runCli(["config", "set", "monitoringEnabled", "yes"], { client: fake, stderr: (line) => stderr.push(line) })).toBe(1)
    expect(await runCli(["config", "set", "unknown", "x"], { client: fake, stderr: (line) => stderr.push(line) })).toBe(1)
    expect(called).toBe(false)
    expect(stderr).toHaveLength(2)
  })
})
