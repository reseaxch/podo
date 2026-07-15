// Fixture-integrity gate for the canonical cache-growth scenario.
//
// This is a true cross-boundary test: it exercises the scenario's deterministic
// telemetry generator and the Graphify plugin's public decoder against the
// COMMITTED canonical fixtures under scenarios/cache-growth/fixtures/. It never
// writes, copies, regenerates, or mutates either fixture on disk.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  buildTelemetryEvents,
  serializeTelemetry,
} from "../../scenarios/cache-growth/generate-telemetry"
// Import the Graphify plugin's public package entry — the path resolved by its
// package.json `exports` field (./src/index.ts). This exercises the exported
// consumer boundary rather than internal modules like ./networkx-v1. (The bare
// `@podo/plugin-graphify` specifier is not resolvable here because tests/ is not
// a workspace member, so we reference the same exports entry by its path.)
import { decodeGraphifyNetworkxV1 } from "../../plugins/graphify/src/index"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const FIXTURES = join(REPO_ROOT, "scenarios", "cache-growth", "fixtures")
const TELEMETRY_FIXTURE = join(FIXTURES, "telemetry.json")
const GRAPH_FIXTURE = join(FIXTURES, "graph.json")

describe("cache-growth fixture integrity", () => {
  test("regenerated telemetry matches the committed fixture's canonical LF serialization", () => {
    // Generate in memory only — no filesystem writes.
    const regenerated = serializeTelemetry(buildTelemetryEvents())

    // The repository's canonical serialized form is LF-terminated (the fixture's
    // git blob). A Windows checkout with core.autocrlf materializes it as CRLF on
    // disk, so we compare against the canonical LF serialization rather than the
    // literal working-tree bytes: normalize CRLF -> LF so the gate is
    // deterministic on both Windows and Linux, while still asserting the trailing
    // newline is part of the canonical form.
    const committed = readFileSync(TELEMETRY_FIXTURE, "utf8").replace(/\r\n/g, "\n")

    expect(regenerated).toBe(committed)
    // The canonical serialization includes a trailing newline.
    expect(regenerated.endsWith("]\n")).toBe(true)
    expect(committed.endsWith("]\n")).toBe(true)
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
