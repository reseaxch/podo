// Fixture-integrity gate for the canonical cache-growth scenario.
//
// This is a true cross-boundary test: it exercises the scenario's deterministic
// telemetry generator (incident and after-fix streams) and the Graphify plugin's
// public decoder against the COMMITTED canonical fixtures under
// scenarios/cache-growth/fixtures/. It never writes, copies, regenerates, or
// mutates any fixture on disk.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  buildAfterFixTelemetryEvents,
  buildTelemetryEvents,
  CliArgumentError,
  parseCliMode,
  runGenerateCli,
  serializeTelemetry,
  type TelemetryEvent,
} from "../../scenarios/cache-growth/generate-telemetry"
// Import the Graphify plugin's public package entry — the path resolved by its
// package.json `exports` field (./src/index.ts). This exercises the exported
// consumer boundary rather than internal modules like ./networkx-v1. (The bare
// `@podo/plugin-graphify` specifier is not resolvable here because tests/ is not
// a workspace member, so we reference the same exports entry by its path.)
import { decodeGraphifyNetworkxV1 } from "../../plugins/graphify/src/index"
import type { TelemetryEventInput } from "../../packages/contracts/src/index"
import { IncidentMonitor } from "../../apps/core/src/modules/incidents/incident-monitor"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCENARIO_DIR = join(REPO_ROOT, "scenarios", "cache-growth")
const GENERATOR = join(SCENARIO_DIR, "generate-telemetry.ts")
const FIXTURES = join(SCENARIO_DIR, "fixtures")
const TELEMETRY_FIXTURE = join(FIXTURES, "telemetry.json")
const TELEMETRY_AFTER_FIX_FIXTURE = join(FIXTURES, "telemetry-after-fix.json")
const GRAPH_FIXTURE = join(FIXTURES, "graph.json")

/**
 * Asserts that regenerating `events` in memory reproduces the committed fixture's
 * canonical LF serialization (trailing newline included).
 *
 * The repository's canonical serialized form is LF-terminated (the fixture's git
 * blob). A Windows checkout with core.autocrlf materializes it as CRLF on disk,
 * so we compare against the canonical LF serialization rather than the literal
 * working-tree bytes: normalize CRLF -> LF so the gate is deterministic on both
 * Windows and Linux, while still asserting the trailing newline.
 */
function expectCanonicalLf(events: TelemetryEvent[], fixturePath: string): void {
  const regenerated = serializeTelemetry(events) // generated in memory; no writes
  const committed = readFileSync(fixturePath, "utf8").replace(/\r\n/g, "\n")
  expect(regenerated).toBe(committed)
  expect(regenerated.endsWith("]\n")).toBe(true)
  expect(committed.endsWith("]\n")).toBe(true)
}

describe("cache-growth fixture integrity", () => {
  test("regenerated incident telemetry matches the committed fixture's canonical LF serialization", () => {
    expectCanonicalLf(buildTelemetryEvents(), TELEMETRY_FIXTURE)
  })

  test("regenerated after-fix telemetry matches the committed fixture's canonical LF serialization", () => {
    expectCanonicalLf(buildAfterFixTelemetryEvents(), TELEMETRY_AFTER_FIX_FIXTURE)
  })

  test("after-fix telemetry expresses a remediated, bounded, error-free system", () => {
    const afterFix = buildAfterFixTelemetryEvents()

    // Every event belongs to the post-fix deployment identity.
    expect(afterFix.length).toBeGreaterThan(0)
    for (const event of afterFix) {
      expect(event.deploymentId).toBe("deploy-1043")
    }

    // No trace events, and no error signature in any message.
    expect(afterFix.some((event) => event.kind === "trace")).toBe(false)
    for (const event of afterFix) {
      expect(event.message).not.toContain("500")
      expect(event.message.toLowerCase()).not.toContain("out of memory")
    }

    // Heap metrics exist and are all pinned to the same bounded baseline.
    const heapValues = afterFix
      .filter((event) => event.metric?.name === "process.heap.used")
      .map((event) => event.metric?.value)
    expect(heapValues.length).toBeGreaterThan(0)
    expect(new Set(heapValues).size).toBe(1) // flat — no growth

    // Timestamps are strictly increasing.
    const times = afterFix.map((event) => Date.parse(event.timestamp))
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!)
    }

    // The after-fix stream begins strictly after the incident stream ends
    // (derived from the incident generator, so no hard-coded timestamps drift).
    const incident = buildTelemetryEvents()
    const incidentEnd = Math.max(...incident.map((event) => Date.parse(event.timestamp)))
    expect(times[0]!).toBeGreaterThan(incidentEnd)
  })

  test("Graphify decoder normalizes the committed graph fixture", () => {
    // Read the committed canonical graph.json read-only; never mutate it.
    const raw = JSON.parse(readFileSync(GRAPH_FIXTURE, "utf8")) as unknown

    const result = decodeGraphifyNetworkxV1(raw, { graphId: "cache-growth" })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Expected cache-growth graph identity.
    expect(result.snapshot.source).toEqual({
      provider: "graphify",
      graphId: "cache-growth",
      schemaVersion: "1.0",
    })

    // Incident-critical node: the unbounded CheckoutCache.
    const checkoutCache = result.snapshot.nodes.find(
      (node) => node.kind === "function" && node.label === "CheckoutCache",
    )
    expect(checkoutCache).toMatchObject({
      externalId: "cache_checkoutcache",
      kind: "function",
      label: "CheckoutCache",
      location: {
        path: "demo/services/checkout-service/src/cache.ts",
      },
    })
  })
})

/** Runs the generator CLI with `args`, returning its exit code (no shell). */
async function runGenerator(args: string[]): Promise<number> {
  const child = Bun.spawn(["bun", "run", GENERATOR, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  return await child.exited
}

describe("telemetry generator CLI (fail closed)", () => {
  test("parseCliMode accepts only no args or exactly --after-fix", () => {
    expect(parseCliMode([])).toBe("incident")
    expect(parseCliMode(["--after-fix"])).toBe("after-fix")
  })

  test("parseCliMode rejects unknown, duplicate, and extra arguments", () => {
    expect(() => parseCliMode(["--after-fixx"])).toThrow(CliArgumentError) // typo
    expect(() => parseCliMode(["--afterfix"])).toThrow(CliArgumentError)
    expect(() => parseCliMode(["--after-fix", "--after-fix"])).toThrow(CliArgumentError) // duplicate
    expect(() => parseCliMode(["--after-fix", "extra"])).toThrow(CliArgumentError) // extra
    expect(() => parseCliMode(["extra"])).toThrow(CliArgumentError)
    expect(() => parseCliMode(["--help"])).toThrow(CliArgumentError)
  })

  test("runGenerateCli never invokes the writer for invalid arguments", () => {
    // Primary fail-closed proof: the writer is a spy. A bad invocation must throw
    // BEFORE the writer is called even once — so no write of any kind occurs,
    // including one that would rewrite a file with identical bytes.
    for (const badArgs of [
      ["--after-fixx"], // typo
      ["--after-fix", "--after-fix"], // duplicate
      ["--after-fix", "extra"], // extra
      ["extra"],
      ["--help"],
    ]) {
      let writeCount = 0
      const writeFixture = (): void => {
        writeCount += 1
      }
      expect(() => runGenerateCli({ args: badArgs, writeFixture })).toThrow(CliArgumentError)
      expect(writeCount).toBe(0)
    }
  })

  test("runGenerateCli invokes the writer once with the correct fixture for valid arguments", () => {
    const incidentWrites: Array<{ fileName: string; contents: string }> = []
    const incident = runGenerateCli({
      args: [],
      writeFixture: (fileName, contents) => incidentWrites.push({ fileName, contents }),
    })
    expect(incident).toMatchObject({ mode: "incident", fileName: "telemetry.json" })
    expect(incidentWrites).toHaveLength(1)
    expect(incidentWrites[0]!.fileName).toBe("telemetry.json")
    expect(incidentWrites[0]!.contents).toBe(serializeTelemetry(buildTelemetryEvents()))

    const afterWrites: Array<{ fileName: string; contents: string }> = []
    const after = runGenerateCli({
      args: ["--after-fix"],
      writeFixture: (fileName, contents) => afterWrites.push({ fileName, contents }),
    })
    expect(after).toMatchObject({ mode: "after-fix", fileName: "telemetry-after-fix.json" })
    expect(afterWrites).toHaveLength(1)
    expect(afterWrites[0]!.fileName).toBe("telemetry-after-fix.json")
    expect(afterWrites[0]!.contents).toBe(serializeTelemetry(buildAfterFixTelemetryEvents()))
  })

  test("(secondary) a bad subprocess invocation exits nonzero and leaves both fixtures byte-identical", async () => {
    // Snapshot both committed fixtures (canonical LF) before the bad run.
    const before = {
      incident: readFileSync(TELEMETRY_FIXTURE, "utf8").replace(/\r\n/g, "\n"),
      afterFix: readFileSync(TELEMETRY_AFTER_FIX_FIXTURE, "utf8").replace(/\r\n/g, "\n"),
    }

    // Typo and extra-argument invocations must both fail closed.
    expect(await runGenerator(["--after-fixx"])).not.toBe(0)
    expect(await runGenerator(["--after-fix", "extra"])).not.toBe(0)

    // Neither fixture may have changed.
    expect(readFileSync(TELEMETRY_FIXTURE, "utf8").replace(/\r\n/g, "\n")).toBe(before.incident)
    expect(readFileSync(TELEMETRY_AFTER_FIX_FIXTURE, "utf8").replace(/\r\n/g, "\n")).toBe(
      before.afterFix,
    )
  })
})

describe("after-fix telemetry through the Core ingestion boundary", () => {
  test("Core accepts all 13 events, reacts ignore_healthy, and creates no incident", () => {
    // The committed after-fix fixture is the input; read-only, never mutated.
    const events = JSON.parse(
      readFileSync(TELEMETRY_AFTER_FIX_FIXTURE, "utf8"),
    ) as TelemetryEventInput[]
    expect(events).toHaveLength(13)

    // Drive it through Core's public IncidentMonitor ingestion boundary.
    const result = new IncidentMonitor().ingest(events)

    // All events accepted, none rejected or duplicated.
    expect(result.ingestion.accepted).toBe(13)
    expect(result.ingestion.duplicates).toBe(0)
    expect(result.ingestion.rejected).toEqual([])

    // The remediated stream is healthy: no incident opened.
    expect(result.reaction.action).toBe("ignore_healthy")
    expect(result.incident).toBeNull()
  })
})
