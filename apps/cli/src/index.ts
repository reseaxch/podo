#!/usr/bin/env bun

import { createRootlineClient } from "@rootline/client"

const [command = "help"] = process.argv.slice(2)
const coreUrl = process.env.ROOTLINE_CORE_URL ?? "http://127.0.0.1:4100"
const client = createRootlineClient({ baseUrl: coreUrl })

if (command === "health") {
  console.log(JSON.stringify(await client.health(), null, 2))
} else if (command === "status") {
  console.log(JSON.stringify(await client.systemStatus(), null, 2))
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log(`Rootline CLI

Usage:
  rootline health   Check the core process
  rootline status   Check core and Codex readiness

Environment:
  ROOTLINE_CORE_URL  Core base URL (default: http://127.0.0.1:4100)`)
} else {
  console.error(`Unknown command: ${command}`)
  process.exitCode = 1
}
