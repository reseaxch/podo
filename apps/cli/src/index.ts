#!/usr/bin/env bun

import { isAbsolute } from "node:path"

import {
  createPodoClient,
  type PodoIncidentClient,
  type PodoRemediationClient,
} from "@podo/client"

type UpdateSettingsRequest = Parameters<PodoIncidentClient["updateSettings"]>[0]
type CliClient = PodoIncidentClient & PodoRemediationClient

interface CliDependencies {
  client?: CliClient
  stdout?: (line: string) => void
  stderr?: (line: string) => void
}

const help = `Podo CLI

Usage:
  podo health                              Check the core process
  podo status                              Check core and Codex readiness
  podo config show                         Show effective Podo settings
  podo config set <key> <value>            Update one Podo setting
  podo incidents list                      List detected incidents
  podo incidents show <incidentId>         Show one incident
  podo incidents path <incidentId> <evidenceId>
                                            Show its evidence-specific causal path
  podo incidents investigate <incidentId> <absolute-cwd>
                                            Start its core-owned investigation
  podo incidents remediate <incidentId>     Request an approval-gated remediation
  podo incidents remediation <incidentId>   Show its remediation state
  podo incidents approve-remediation <incidentId> <approvalId>
                                            Approve its pending remediation
  podo incidents deny-remediation <incidentId> <approvalId>
                                            Deny its pending remediation

Settings:
  autonomyMode       observe | recommend | act_with_approval
  monitoringEnabled  true | false
  defaultSandbox     read-only | workspace-write
  turnTimeoutMs      integer milliseconds (1000..3600000)

Environment:
  PODO_CORE_URL  Core base URL (default: http://127.0.0.1:4100)`

export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.stdout ?? console.log
  const error = dependencies.stderr ?? console.error
  const coreUrl = process.env.PODO_CORE_URL ?? "http://127.0.0.1:4100"
  const client = dependencies.client ?? createPodoClient({ baseUrl: coreUrl })
  const [command = "help", subcommand, firstArgument, secondArgument] = args

  if (command === "health") {
    output(JSON.stringify(await client.health(), null, 2))
    return 0
  }
  if (command === "status") {
    output(JSON.stringify(await client.systemStatus(), null, 2))
    return 0
  }
  if (
    command === "config" &&
    subcommand === "show" &&
    firstArgument === undefined
  ) {
    output(JSON.stringify(await client.getSettings(), null, 2))
    return 0
  }
  if (command === "config" && subcommand === "set") {
    const patch = parseSetting(firstArgument, secondArgument)
    if (!patch) {
      error("Invalid setting key or value. Run `podo help` for accepted settings.")
      return 1
    }
    output(JSON.stringify(await client.updateSettings(patch), null, 2))
    return 0
  }
  if (
    command === "incidents" &&
    subcommand === "list" &&
    firstArgument === undefined
  ) {
    output(JSON.stringify(await client.listIncidents(), null, 2))
    return 0
  }
  if (command === "incidents" && subcommand === "show") {
    if (args.length !== 3 || !isNonBlank(firstArgument)) {
      error("Invalid arguments. Usage: podo incidents show <incidentId>")
      return 1
    }
    output(JSON.stringify(await client.getIncident(firstArgument), null, 2))
    return 0
  }
  if (command === "incidents" && subcommand === "path") {
    if (
      args.length !== 4 ||
      !isNonBlank(firstArgument) ||
      !isNonBlank(secondArgument)
    ) {
      error(
        "Invalid arguments. Usage: podo incidents path <incidentId> <evidenceId>",
      )
      return 1
    }
    output(
      JSON.stringify(
        await client.getIncidentCausalPath(firstArgument, secondArgument),
        null,
        2,
      ),
    )
    return 0
  }
  if (command === "incidents" && subcommand === "investigate") {
    if (
      args.length !== 4 ||
      !isNonBlank(firstArgument) ||
      !isNonBlank(secondArgument) ||
      !isAbsolute(secondArgument)
    ) {
      error(
        "Invalid arguments. Usage: podo incidents investigate <incidentId> <absolute-cwd>",
      )
      return 1
    }
    output(
      JSON.stringify(
        await client.startIncidentInvestigation(firstArgument, {
          cwd: secondArgument,
        }),
        null,
        2,
      ),
    )
    return 0
  }
  if (command === "incidents" && subcommand === "remediate") {
    if (args.length !== 3 || !isNonBlank(firstArgument)) {
      error("Invalid arguments. Usage: podo incidents remediate <incidentId>")
      return 1
    }
    output(
      JSON.stringify(await client.startIncidentRemediation(firstArgument), null, 2),
    )
    return 0
  }
  if (command === "incidents" && subcommand === "remediation") {
    if (args.length !== 3 || !isNonBlank(firstArgument)) {
      error("Invalid arguments. Usage: podo incidents remediation <incidentId>")
      return 1
    }
    output(
      JSON.stringify(await client.getIncidentRemediation(firstArgument), null, 2),
    )
    return 0
  }
  if (command === "incidents" && subcommand === "approve-remediation") {
    if (
      args.length !== 4
      || !isNonBlank(firstArgument)
      || !isNonBlank(secondArgument)
    ) {
      error(
        "Invalid arguments. Usage: podo incidents approve-remediation <incidentId> <approvalId>",
      )
      return 1
    }
    output(
      JSON.stringify(
        await client.approveIncidentRemediation(firstArgument, secondArgument),
        null,
        2,
      ),
    )
    return 0
  }
  if (command === "incidents" && subcommand === "deny-remediation") {
    if (
      args.length !== 4
      || !isNonBlank(firstArgument)
      || !isNonBlank(secondArgument)
    ) {
      error(
        "Invalid arguments. Usage: podo incidents deny-remediation <incidentId> <approvalId>",
      )
      return 1
    }
    output(
      JSON.stringify(
        await client.denyIncidentRemediation(firstArgument, secondArgument),
        null,
        2,
      ),
    )
    return 0
  }
  if (command === "help" || command === "--help" || command === "-h") {
    output(help)
    return 0
  }

  error(`Unknown command: ${args.join(" ")}`)
  return 1
}

function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
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
