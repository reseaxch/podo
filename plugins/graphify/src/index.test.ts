import { describe, expect, test } from "bun:test"

import { normalizeGraphifyGraph } from "./index"

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
