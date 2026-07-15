import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { decodeGraphifyNetworkxV1, normalizeGraphifyGraph } from "./index"

const canonicalPayload = {
  schemaVersion: "1.0",
  graphId: "demo-monorepo",
  nodes: [
    {
      id: "repo:root",
      kind: "repository",
      name: "demo-monorepo",
      provenance: "extracted",
    },
    {
      id: "service:checkout",
      kind: "service",
      name: "checkout-service",
      location: { path: "services/checkout", line: 1, column: 1 },
      provenance: "inferred",
    },
    {
      id: "file:cache",
      kind: "file",
      name: "cache.ts",
      location: {
        path: "services/checkout/src/cache.ts",
        line: 1,
        column: 1,
        endLine: 42,
        endColumn: 2,
      },
      provenance: "extracted",
    },
  ],
  relations: [
    {
      id: "relation:repo-service",
      type: "CONTAINS",
      from: "repo:root",
      to: "service:checkout",
      provenance: "ambiguous",
    },
    {
      id: "relation:service-file",
      type: "OWNS",
      from: "service:checkout",
      to: "file:cache",
      location: { path: "services/checkout/package.json", line: 2 },
      provenance: "extracted",
    },
  ],
} as const

describe("normalizeGraphifyGraph", () => {
  test("normalizes a supported graph without losing external identity, provenance, or locations", () => {
    const result = normalizeGraphifyGraph(canonicalPayload)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.snapshot.id).toMatch(/^graph_snapshot_[a-f0-9]{24}$/)
    expect(result.snapshot.schemaVersion).toBe("podo.code-graph.v1")
    expect(result.snapshot.source).toEqual({
      provider: "graphify",
      graphId: "demo-monorepo",
      schemaVersion: "1.0",
    })
    expect(result.snapshot.nodes).toHaveLength(3)
    expect(result.snapshot.links).toHaveLength(2)

    const file = result.snapshot.nodes.find((node) => node.externalId === "file:cache")
    expect(file?.id).toMatch(/^graph_node_[a-f0-9]{24}$/)
    expect(file).toMatchObject({
      externalId: "file:cache",
      kind: "file",
      label: "cache.ts",
      provenance: "extracted",
      location: {
        path: "services/checkout/src/cache.ts",
        line: 1,
        column: 1,
        endLine: 42,
        endColumn: 2,
      },
    })

    const ownership = result.snapshot.links.find(
      (link) => link.externalId === "relation:service-file",
    )
    expect(ownership?.id).toMatch(/^graph_link_[a-f0-9]{24}$/)
    expect(ownership).toMatchObject({
      externalId: "relation:service-file",
      type: "OWNS",
      fromExternalId: "service:checkout",
      toExternalId: "file:cache",
      provenance: "extracted",
      location: { path: "services/checkout/package.json", line: 2 },
    })
    expect(ownership?.fromNodeId).toBe(
      result.snapshot.nodes.find((node) => node.externalId === "service:checkout")?.id,
    )
    expect(ownership?.toNodeId).toBe(
      result.snapshot.nodes.find((node) => node.externalId === "file:cache")?.id,
    )
  })

  test("is byte-stable when nodes and relations arrive in a different order", () => {
    const reordered = {
      ...canonicalPayload,
      nodes: [...canonicalPayload.nodes].reverse(),
      relations: [...canonicalPayload.relations].reverse(),
    }

    const first = normalizeGraphifyGraph(canonicalPayload)
    const second = normalizeGraphifyGraph(reordered)

    expect(first).toEqual(second)
    if (first.ok && second.ok) {
      expect(JSON.stringify(first.snapshot)).toBe(JSON.stringify(second.snapshot))
    }
  })

  test("keeps entity identity stable across content updates while changing snapshot identity", () => {
    const initial = normalizeGraphifyGraph(canonicalPayload)
    const updated = normalizeGraphifyGraph({
      ...canonicalPayload,
      nodes: canonicalPayload.nodes.map((node) =>
        node.id === "file:cache" ? { ...node, name: "bounded-cache.ts" } : node,
      ),
    })

    expect(initial.ok).toBe(true)
    expect(updated.ok).toBe(true)
    if (!initial.ok || !updated.ok) return

    const initialFile = initial.snapshot.nodes.find((node) => node.externalId === "file:cache")
    const updatedFile = updated.snapshot.nodes.find((node) => node.externalId === "file:cache")
    expect(updatedFile?.id).toBe(initialFile?.id)
    expect(updatedFile?.label).toBe("bounded-cache.ts")
    expect(updated.snapshot.id).not.toBe(initial.snapshot.id)
  })

  test("rejects duplicate and conflicting external identities deterministically", () => {
    const duplicate = canonicalPayload.nodes[0]
    const conflict = { ...duplicate, name: "other-repository" }
    const input = {
      ...canonicalPayload,
      nodes: [conflict, ...canonicalPayload.nodes, duplicate],
    }

    const result = normalizeGraphifyGraph(input)

    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "GRAPHIFY_IMPORT_REJECTED",
        issues: [
          {
            code: "conflicting_external_id",
            path: "nodes[id=repo:root]",
            message: 'External node ID "repo:root" identifies conflicting nodes',
          },
        ],
      },
    })
  })

  test("rejects repeated identical identities instead of coalescing them silently", () => {
    const repeated = canonicalPayload.relations[0]
    const result = normalizeGraphifyGraph({
      ...canonicalPayload,
      relations: [repeated, ...canonicalPayload.relations, repeated],
    })

    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "GRAPHIFY_IMPORT_REJECTED",
        issues: [
          {
            code: "duplicate_external_id",
            path: "relations[id=relation:repo-service]",
            message: 'External relation ID "relation:repo-service" appears more than once',
          },
        ],
      },
    })
  })

  test("rejects dangling endpoints and unknown relation types instead of dropping links", () => {
    const input = {
      ...canonicalPayload,
      relations: [
        {
          id: "relation:dangling",
          type: "OWNS",
          from: "service:missing",
          to: "file:cache",
          provenance: "extracted",
        },
        {
          id: "relation:unknown",
          type: "DEPENDS_ON",
          from: "service:checkout",
          to: "file:cache",
          provenance: "extracted",
        },
      ],
    }

    const result = normalizeGraphifyGraph(input)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.issues).toEqual([
      {
        code: "dangling_endpoint",
        path: "relations[id=relation:dangling].from",
        message: 'Relation endpoint "service:missing" does not identify a node',
      },
      {
        code: "unsupported_value",
        path: "relations[id=relation:unknown].type",
        message: 'Unsupported relation type "DEPENDS_ON"',
      },
    ])
  })

  test("rejects unsupported schemas, malformed locations, and invalid provenance atomically", () => {
    const input = {
      ...canonicalPayload,
      schemaVersion: "2.0",
      nodes: [
        canonicalPayload.nodes[0],
        {
          ...canonicalPayload.nodes[1],
          provenance: "generated",
          location: { path: "../outside.ts", line: 0, endColumn: 2 },
        },
        canonicalPayload.nodes[2],
      ],
    }

    const result = normalizeGraphifyGraph(input)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result).not.toHaveProperty("snapshot")
    expect(result.rejection.issues).toEqual([
      {
        code: "invalid_location",
        path: "nodes[id=service:checkout].location.endColumn",
        message: "endColumn requires endLine",
      },
      {
        code: "invalid_location",
        path: "nodes[id=service:checkout].location.line",
        message: "line must be a positive integer",
      },
      {
        code: "invalid_location",
        path: "nodes[id=service:checkout].location.path",
        message: "path must be a normalized repository-relative path",
      },
      {
        code: "unsupported_value",
        path: "nodes[id=service:checkout].provenance",
        message: 'Unsupported provenance "generated"',
      },
      {
        code: "unsupported_schema_version",
        path: "schemaVersion",
        message: 'Unsupported Graphify schema version "2.0"; expected "1.0"',
      },
    ])
  })
})

describe("decodeGraphifyNetworkxV1", () => {
  const fixtureUrl = new URL(
    "../../../scenarios/cache-growth/fixtures/graph.json",
    import.meta.url,
  )
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as unknown

  test("decodes the canonical fixture into a stable cache file and function path", () => {
    const first = decodeGraphifyNetworkxV1(fixture, { graphId: "cache-growth" })
    const reorderedRaw = structuredClone(fixture) as {
      nodes: unknown[]
      links: unknown[]
    }
    reorderedRaw.nodes.reverse()
    reorderedRaw.links.reverse()
    const reordered = decodeGraphifyNetworkxV1(reorderedRaw, { graphId: "cache-growth" })

    expect(first.ok).toBe(true)
    expect(reordered).toEqual(first)
    if (!first.ok) return

    const cacheFile = first.snapshot.nodes.find(
      (node) => node.kind === "file" && node.label === "cache.ts",
    )
    const checkoutCache = first.snapshot.nodes.find(
      (node) => node.kind === "function" && node.label === "CheckoutCache",
    )
    expect(cacheFile).toMatchObject({
      externalId: "demo_services_checkout_service_src_cache_ts",
      provenance: "extracted",
      location: {
        path: "demo/services/checkout-service/src/cache.ts",
        line: 1,
      },
    })
    expect(checkoutCache).toMatchObject({
      externalId: "cache_checkoutcache",
      provenance: "extracted",
      location: {
        path: "demo/services/checkout-service/src/cache.ts",
        line: 15,
      },
    })
    expect(first.snapshot.links).toContainEqual(
      expect.objectContaining({
        type: "CONTAINS",
        fromExternalId: cacheFile?.externalId,
        toExternalId: checkoutCache?.externalId,
        provenance: "extracted",
        location: {
          path: "demo/services/checkout-service/src/cache.ts",
          line: 15,
        },
      }),
    )
    expect(first.snapshot.nodes).toContainEqual(
      expect.objectContaining({ kind: "repository", label: "demo" }),
    )
    expect(first.snapshot.nodes).toContainEqual(
      expect.objectContaining({ kind: "service", label: "checkout-service" }),
    )
  })

  test("fails closed on malformed locations and dangling supported relations", () => {
    const malformed = structuredClone(fixture) as {
      nodes: Array<Record<string, unknown>>
      links: Array<Record<string, unknown>>
    }
    const cache = malformed.nodes.find((node) => node.id === "cache_checkoutcache")
    if (!cache) throw new Error("canonical cache node is missing")
    cache.source_location = "line fifteen"
    const contains = malformed.links.find(
      (link) => link._src === "demo_services_checkout_service_src_cache_ts",
    )
    if (!contains) throw new Error("canonical cache relation is missing")
    contains._tgt = "missing_cache_symbol"
    contains.target = "missing_cache_symbol"
    contains.confidence = "UNVERIFIED"

    const result = decodeGraphifyNetworkxV1(malformed, { graphId: "cache-growth" })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.issues).toContainEqual({
      code: "invalid_location",
      path: "raw.nodes[id=cache_checkoutcache].source_location",
      message: 'Expected source_location in "L<n>" form, received "line fifteen"',
    })
    expect(result.rejection.issues).toContainEqual({
      code: "dangling_endpoint",
      path: "raw.links[relation=contains,source=demo_services_checkout_service_src_cache_ts,target=missing_cache_symbol].target",
      message: 'Supported relation target "missing_cache_symbol" does not identify a code node',
    })
    expect(result.rejection.issues).toContainEqual({
      code: "unsupported_value",
      path: "raw.links[relation=contains,source=demo_services_checkout_service_src_cache_ts,target=missing_cache_symbol].confidence",
      message: 'Unsupported confidence "UNVERIFIED"',
    })
  })

  test("rejects an ambiguous raw file identity instead of selecting one node", () => {
    const ambiguous = structuredClone(fixture) as {
      nodes: Array<Record<string, unknown>>
    }
    const cacheFile = ambiguous.nodes.find(
      (node) => node.id === "demo_services_checkout_service_src_cache_ts",
    )
    if (!cacheFile) throw new Error("canonical cache file is missing")
    ambiguous.nodes.push({ ...cacheFile, id: "duplicate_cache_file" })

    const result = decodeGraphifyNetworkxV1(ambiguous, { graphId: "cache-growth" })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.issues).toContainEqual({
      code: "ambiguous_value",
      path: "raw.nodes[source_file=demo/services/checkout-service/src/cache.ts]",
      message: 'Source file "demo/services/checkout-service/src/cache.ts" identifies multiple file nodes: demo_services_checkout_service_src_cache_ts, duplicate_cache_file',
    })
  })
})
