import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  ProductionIncidentGraphConfigError,
  loadProductionIncidentGraph,
} from "./production-incident-graph"

const bootstrapUrl = new URL(
  "../../../../scenarios/cache-growth/graph-bootstrap.json",
  import.meta.url,
)
const enabledEnvironment = {
  PODO_INCIDENT_GRAPH_ENABLED: "true",
  PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: fileURLToPath(bootstrapUrl),
}
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("production incident graph bootstrap is disabled unless explicitly enabled", async () => {
  expect(await loadProductionIncidentGraph({})).toBeUndefined()
  expect(await loadProductionIncidentGraph({ PODO_INCIDENT_GRAPH_ENABLED: "false" })).toBeUndefined()
})

test("production incident graph bootstrap requires a normalized absolute manifest path", async () => {
  for (const environment of [
    { PODO_INCIDENT_GRAPH_ENABLED: "yes" },
    { PODO_INCIDENT_GRAPH_ENABLED: "true" },
    {
      PODO_INCIDENT_GRAPH_ENABLED: "true",
      PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: "scenarios/cache-growth/graph-bootstrap.json",
    },
  ]) {
    await expect(loadProductionIncidentGraph(environment)).rejects.toBeInstanceOf(
      ProductionIncidentGraphConfigError,
    )
  }
})

test("production incident graph bootstrap loads one strict normalized graph", async () => {
  const graph = await loadProductionIncidentGraph(enabledEnvironment)

  expect(graph?.codeGraph).toMatchObject({
    schemaVersion: "podo.code-graph.v1",
    source: {
      provider: "graphify",
      graphId: "cache-growth",
      schemaVersion: "1.0",
    },
  })
  expect(graph?.trustedCorrelations).toHaveLength(1)
  expect(graph?.trustedCorrelations[0]).toMatchObject({
    deploymentId: "deploy-1042",
    containerId: "checkout-service-7b9c",
    commitSha: "d34db33fd34db33fd34db33fd34db33fd34db33f",
  })
  expect(graph?.codeGraph.nodes.find(
    ({ id }) => id === graph.trustedCorrelations[0]?.changedFileNodeId,
  )).toMatchObject({
    kind: "file",
    label: "cache.ts",
    location: { path: "demo/services/checkout-service/src/cache.ts" },
  })
})

test("production incident graph bootstrap rejects malformed manifests and decoder input atomically", async () => {
  const canonicalManifest = await Bun.file(bootstrapUrl).json() as Record<string, unknown>
  const invalidManifests = [
    { ...canonicalManifest, extra: true },
    { ...canonicalManifest, schemaVersion: "unknown" },
    { ...canonicalManifest, decoder: "unknown" },
    { ...canonicalManifest, trustedCorrelations: [] },
    {
      ...canonicalManifest,
      trustedCorrelations: [
        ...(canonicalManifest.trustedCorrelations as unknown[]),
        ...(canonicalManifest.trustedCorrelations as unknown[]),
      ],
    },
  ]

  for (const manifest of invalidManifests) {
    await expect(loadProductionIncidentGraph(enabledEnvironment, {
      async readJson() {
        return manifest
      },
    })).rejects.toThrow("invalid_production_incident_graph_config")
  }

  let reads = 0
  await expect(loadProductionIncidentGraph(enabledEnvironment, {
    async readJson(url) {
      reads += 1
      return reads === 1 ? Bun.file(url).json() : {}
    },
  })).rejects.toThrow("invalid_production_incident_graph_config")
})

test("production incident graph bootstrap rejects traversal-shaped fixture paths before graph access", async () => {
  const canonicalManifest = await Bun.file(bootstrapUrl).json() as Record<string, unknown>
  for (const fixture of [
    "../fixtures/graph.json",
    "%2e%2e/%2e%2e/secret.json",
    "fixtures/graph.json?other",
    "fixtures/graph.json#other",
    "fixtures\\graph.json",
  ]) {
    let reads = 0
    await expect(loadProductionIncidentGraph(enabledEnvironment, {
      async readJson() {
        reads += 1
        return { ...canonicalManifest, fixture }
      },
    })).rejects.toThrow("invalid_production_incident_graph_config")
    expect(reads).toBe(1)
  }
})

test("production incident graph bootstrap rejects a fixture symlink that escapes the manifest directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "podo-graph-bootstrap-"))
  temporaryRoots.push(root)
  const outside = await mkdtemp(join(tmpdir(), "podo-graph-escape-"))
  temporaryRoots.push(outside)

  // Real graph fixture placed OUTSIDE the manifest root.
  const canonicalGraph = await Bun.file(
    new URL("../../../../scenarios/cache-growth/fixtures/graph.json", import.meta.url),
  ).text()
  await Bun.write(join(outside, "graph.json"), canonicalGraph)

  // Directory junction (dir symlink on Unix) at <root>/fixtures -> outside dir.
  // Junctions need no elevation/Developer Mode on Windows and require an absolute target.
  await symlink(outside, join(root, "fixtures"), "junction")

  const manifest = await Bun.file(bootstrapUrl).json() as Record<string, unknown>
  const manifestPath = join(root, "graph-bootstrap.json")
  await Bun.write(manifestPath, JSON.stringify(manifest))

  await expect(loadProductionIncidentGraph({
    PODO_INCIDENT_GRAPH_ENABLED: "true",
    PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: manifestPath,
  })).rejects.toThrow("invalid_production_incident_graph_config")
})

test("production incident graph bootstrap enforces the manifest byte limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "podo-graph-bootstrap-"))
  temporaryRoots.push(root)
  const manifestPath = join(root, "graph-bootstrap.json")
  await Bun.write(manifestPath, " ".repeat(64 * 1024 + 1))

  await expect(loadProductionIncidentGraph({
    PODO_INCIDENT_GRAPH_ENABLED: "true",
    PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: manifestPath,
  })).rejects.toThrow("invalid_production_incident_graph_config")
})

test("production incident graph bootstrap rejects missing or non-file selectors", async () => {
  const canonicalManifest = await Bun.file(bootstrapUrl).json() as {
    trustedCorrelations: Array<Record<string, unknown>>
  } & Record<string, unknown>

  for (const changedFile of [
    { label: "missing.ts", path: "demo/services/checkout-service/src/missing.ts" },
    { label: "CheckoutCache", path: "demo/services/checkout-service/src/cache.ts" },
  ]) {
    let reads = 0
    await expect(loadProductionIncidentGraph(enabledEnvironment, {
      async readJson(url) {
        reads += 1
        if (reads === 2) return Bun.file(url).json()
        return {
          ...canonicalManifest,
          trustedCorrelations: [{
            ...canonicalManifest.trustedCorrelations[0],
            changedFile,
          }],
        }
      },
    })).rejects.toThrow("invalid_production_incident_graph_config")
  }
})

test("production incident graph bootstrap sanitizes filesystem and parser failures", async () => {
  await expect(loadProductionIncidentGraph(enabledEnvironment, {
    async readJson() {
      throw new Error("private path and fixture content")
    },
  })).rejects.toEqual(new ProductionIncidentGraphConfigError())
})
