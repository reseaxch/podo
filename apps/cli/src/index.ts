#!/usr/bin/env bun

import { createRootlineClient, type RootlineClient } from "@rootline/client"

type UpdateSettingsRequest = Parameters<RootlineClient["updateSettings"]>[0]

interface CliDependencies {
  client?: RootlineClient
  stdout?: (line: string) => void
  stderr?: (line: string) => void
}

const help = `Rootline CLI

Usage:
  rootline health                              Check the core process
  rootline status                              Check core and Codex readiness
  rootline config show                         Show effective Rootline settings
  rootline config set <key> <value>            Update one Rootline setting

Settings:
  autonomyMode       observe | recommend | act_with_approval
  monitoringEnabled  true | false
  defaultSandbox     read-only | workspace-write
  turnTimeoutMs      integer milliseconds (1000..3600000)

Environment:
  ROOTLINE_CORE_URL  Core base URL (default: http://127.0.0.1:4100)`

export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.stdout ?? console.log
  const error = dependencies.stderr ?? console.error
  const coreUrl = process.env.ROOTLINE_CORE_URL ?? "http://127.0.0.1:4100"
  const client = dependencies.client ?? createRootlineClient({ baseUrl: coreUrl })
  const [command = "help", subcommand, key, rawValue] = args

  if (command === "health") {
    output(JSON.stringify(await client.health(), null, 2))
    return 0
  }
  if (command === "status") {
    output(JSON.stringify(await client.systemStatus(), null, 2))
    return 0
  }
  if (command === "config" && subcommand === "show" && key === undefined) {
    output(JSON.stringify(await client.getSettings(), null, 2))
    return 0
  }
  if (command === "config" && subcommand === "set") {
    const patch = parseSetting(key, rawValue)
    if (!patch) {
      error("Invalid setting key or value. Run `rootline help` for accepted settings.")
      return 1
    }
    output(JSON.stringify(await client.updateSettings(patch), null, 2))
    return 0
  }
  if (command === "help" || command === "--help" || command === "-h") {
    output(help)
    return 0
  }

  error(`Unknown command: ${args.join(" ")}`)
  return 1
}

function parseSetting(key: string | undefined, value: string | undefined): UpdateSettingsRequest | null {
  if (key === "autonomyMode" && (value === "observe" || value === "recommend" || value === "act_with_approval")) return { autonomyMode: value }
  if (key === "monitoringEnabled" && (value === "true" || value === "false")) return { monitoringEnabled: value === "true" }
  if (key === "defaultSandbox" && (value === "read-only" || value === "workspace-write")) return { defaultSandbox: value }
  if (key === "turnTimeoutMs" && value && /^\d+$/.test(value)) {
    const timeout = Number(value)
    if (Number.isSafeInteger(timeout) && timeout >= 1_000 && timeout <= 3_600_000) return { turnTimeoutMs: timeout }
  }
  return null
}

if (import.meta.main) {
  try {
    process.exitCode = await runCli(process.argv.slice(2))
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  }
}
