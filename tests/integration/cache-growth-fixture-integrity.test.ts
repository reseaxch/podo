// Fixture-integrity gate for the canonical cache-growth scenario.
//
// This is a true cross-boundary test: it exercises the scenario's deterministic
// telemetry generator (incident and after-fix streams) and the Graphify plugin's
// public decoder against the COMMITTED canonical fixtures under
// scenarios/cache-growth/fixtures/. It never writes, copies, regenerates, or
// mutates any fixture on disk.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  buildAfterFixTelemetryEvents,
  buildTelemetryEvents,
  serializeTelemetry,
  type TelemetryEvent,
} from "../../scenarios/cache-growth/generate-telemetry"
// Import the Graphify plugin's public package entry — the path resolved by its
// package.json `exports` field (./src/index.ts). This exercises the exported
// consumer boundary rather than internal modules like ./networkx-v1. (The bare
// `@podo/plugin-graphify` specifier is not resolvable here because tests/ is not
// a workspace member, so we reference the same exports entry by its path.)
import {
  decodeGraphifyNetworkxV1,
  GRAPHIFY_NETWORKX_DECODER_VERSION,
  GRAPHIFY_SCHEMA_VERSION,
  PODO_CODE_GRAPH_SCHEMA_VERSION,
} from "../../plugins/graphify/src/index"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const FIXTURES = join(REPO_ROOT, "scenarios", "cache-growth", "fixtures")
const TELEMETRY_FIXTURE = join(FIXTURES, "telemetry.json")
const TELEMETRY_AFTER_FIX_FIXTURE = join(FIXTURES, "telemetry-after-fix.json")
const GRAPH_FIXTURE = join(FIXTURES, "graph.json")
const GRAPH_COMPAT_MANIFEST = join(FIXTURES, "graph.compat.json")

/** Reads a text file and normalizes CRLF -> LF (canonical form). */
function readCanonicalLf(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n")
}

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

  test("graph compatibility manifest matches the committed fixture and public decoder", () => {
    // The manifest records only verifiable data: the fixture identity, the
    // public decoder/schema versions, the canonical-LF hash of graph.json, and
    // the decoder's snapshot fingerprint. Every value is re-derived here and
    // must match exactly; any decoder/version/schema mismatch or graph-content
    // drift fails this gate closed.
    const manifest = JSON.parse(readFileSync(GRAPH_COMPAT_MANIFEST, "utf8")) as {
      status: string
      fixture: string
      graphId: string
      decoderVersion: string
      graphifySchemaVersion: string
      codeGraphSchemaVersion: string
      graphCanonicalLfSha256: string
      snapshotId: string
    }

    // Identity + candidate status.
    expect(manifest.status).toBe("candidate")
    expect(manifest.fixture).toBe("graph.json")
    expect(manifest.graphId).toBe("cache-growth")

    // Versions must match the public decoder/schema constants exactly.
    expect(manifest.decoderVersion).toBe(GRAPHIFY_NETWORKX_DECODER_VERSION)
    expect(manifest.graphifySchemaVersion).toBe(GRAPHIFY_SCHEMA_VERSION)
    expect(manifest.codeGraphSchemaVersion).toBe(PODO_CODE_GRAPH_SCHEMA_VERSION)

    // Canonical-LF SHA-256 of the committed graph fixture (CRLF -> LF first, as
    // with telemetry) must match the recorded hash — content drift fails closed.
    const graphLf = readCanonicalLf(GRAPH_FIXTURE)
    const graphSha = createHash("sha256").update(graphLf, "utf8").digest("hex")
    expect(graphSha).toBe(manifest.graphCanonicalLfSha256)

    // The public decoder must accept the fixture and produce the recorded
    // snapshot fingerprint and schema identity.
    const result = decodeGraphifyNetworkxV1(JSON.parse(graphLf), { graphId: manifest.graphId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.id).toBe(manifest.snapshotId)
    expect(result.snapshot.schemaVersion).toBe(manifest.codeGraphSchemaVersion)
    expect(result.snapshot.source.graphId).toBe(manifest.graphId)
    expect(result.snapshot.source.schemaVersion).toBe(manifest.graphifySchemaVersion)
  })
})
