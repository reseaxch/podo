import { describe, expect, test } from "bun:test"
import type { NormalizedCodeGraphSnapshot } from "@podo/contracts"

import {
  InMemoryPodoGraph,
  type OperationalGraphOverlay,
} from "./in-memory-graph"

const codeGraph: NormalizedCodeGraphSnapshot = {
  id: "graph_snapshot_cache_growth",
  schemaVersion: "podo.code-graph.v1",
  source: {
    provider: "graphify",
    graphId: "demo-monorepo",
    schemaVersion: "1.0",
  },
  nodes: [
    codeNode("code:repo", "repository", "demo-monorepo"),
    codeNode("code:service", "service", "checkout-service"),
    codeNode("code:file", "file", "cache.ts", {
      path: "demo/services/checkout-service/src/cache.ts",
      line: 1,
    }),
    codeNode("code:function", "function", "CheckoutCache.set", {
      path: "demo/services/checkout-service/src/cache.ts",
      line: 22,
      column: 3,
    }),
    codeNode("code:endpoint", "endpoint", "POST /checkout"),
  ],
  links: [
    codeLink("link:repo-service", "CONTAINS", "code:repo", "code:service"),
    codeLink("link:service-file", "OWNS", "code:service", "code:file"),
    codeLink("link:file-function", "CONTAINS", "code:file", "code:function"),
    codeLink("link:service-endpoint", "EXPOSES", "code:service", "code:endpoint"),
    codeLink("link:endpoint-function", "CALLS", "code:endpoint", "code:function"),
  ],
}

const overlay: OperationalGraphOverlay = {
  nodes: [
    { id: "commit:defect", kind: "commit", sha: "defect-sha" },
    { id: "deployment:1042", kind: "deployment" },
    { id: "container:checkout", kind: "container" },
    {
      id: "telemetry:heap",
      kind: "telemetry_event",
      occurredAt: "2026-07-14T16:05:00.000Z",
    },
    { id: "incident:cache-growth", kind: "incident" },
    { id: "evidence:heap", kind: "evidence" },
  ],
  links: [
    opLink("SUPPORTED_BY", "incident:cache-growth", "evidence:heap"),
    opLink("DERIVED_FROM", "evidence:heap", "telemetry:heap"),
    opLink("OBSERVED_IN", "telemetry:heap", "container:checkout"),
    opLink("RUNS", "container:checkout", "deployment:1042"),
    opLink("USES", "deployment:1042", "commit:defect"),
    opLink("CHANGED", "commit:defect", "code:file"),
  ],
}

describe("InMemoryPodoGraph", () => {
  test("loads a normalized snapshot and resolves the evidence-backed cache-growth path", () => {
    const graph = new InMemoryPodoGraph()
    const loaded = graph.load({ codeGraph, operationalOverlay: overlay })

    expect(loaded).toMatchObject({
      ok: true,
      graph: {
        id: expect.stringMatching(/^podo_graph_[a-f0-9]{24}$/),
        nodeCount: 11,
        linkCount: 11,
      },
    })

    const result = graph.resolveCausalPath({
      incidentId: "incident:cache-growth",
      evidenceId: "evidence:heap",
    })
    expect(result).toEqual({
      ok: true,
      path: {
        id: expect.stringMatching(/^causal_path_[a-f0-9]{24}$/),
        incidentNodeId: "incident:cache-growth",
        evidenceNodeId: "evidence:heap",
        telemetryEventNodeId: "telemetry:heap",
        containerNodeId: "container:checkout",
        deploymentNodeId: "deployment:1042",
        commitNodeId: "commit:defect",
        fileNodeId: "code:file",
        functionNodeId: "code:function",
        nodeIds: [
          "incident:cache-growth",
          "evidence:heap",
          "telemetry:heap",
          "container:checkout",
          "deployment:1042",
          "commit:defect",
          "code:file",
          "code:function",
        ],
      },
    })
    expect(graph.getCodeNode("code:function")).toEqual(codeGraph.nodes[3]!)
  })

  test("is deterministic when code and overlay arrays are reordered", () => {
    const first = new InMemoryPodoGraph()
    const second = new InMemoryPodoGraph()

    const firstLoad = first.load({ codeGraph, operationalOverlay: overlay })
    const secondLoad = second.load({
      codeGraph: {
        ...codeGraph,
        nodes: [...codeGraph.nodes].reverse(),
        links: [...codeGraph.links].reverse(),
      },
      operationalOverlay: {
        nodes: [...overlay.nodes].reverse(),
        links: [...overlay.links].reverse(),
      },
    })

    expect(secondLoad).toEqual(firstLoad)
    expect(
      second.resolveCausalPath({
        incidentId: "incident:cache-growth",
        evidenceId: "evidence:heap",
      }),
    ).toEqual(
      first.resolveCausalPath({
        incidentId: "incident:cache-growth",
        evidenceId: "evidence:heap",
      }),
    )
  })

  test("rejects dangling operational links atomically and preserves the prior graph", () => {
    const graph = new InMemoryPodoGraph()
    expect(graph.load({ codeGraph, operationalOverlay: overlay }).ok).toBe(true)
    const before = graph.resolveCausalPath({
      incidentId: "incident:cache-growth",
      evidenceId: "evidence:heap",
    })

    const invalidOverlay = {
      ...overlay,
      links: overlay.links.map((link) =>
        link.type === "OBSERVED_IN" ? { ...link, toNodeId: "container:missing" } : link,
      ),
    }
    const rejected = graph.load({ codeGraph, operationalOverlay: invalidOverlay })

    expect(rejected).toEqual({
      ok: false,
      rejection: {
        code: "PODO_GRAPH_REJECTED",
        issues: [
          {
            code: "dangling_link",
            path: "operationalOverlay.links[type=OBSERVED_IN,from=telemetry:heap,to=container:missing].toNodeId",
            message: 'Link target "container:missing" does not identify a node',
          },
        ],
      },
    })
    expect(graph.resolveCausalPath({
      incidentId: "incident:cache-growth",
      evidenceId: "evidence:heap",
    })).toEqual(before)
  })

  test("rejects an ambiguous required hop instead of choosing one deployment", () => {
    const graph = new InMemoryPodoGraph()
    const ambiguous: OperationalGraphOverlay = {
      nodes: [
        ...overlay.nodes,
        { id: "deployment:other", kind: "deployment" },
      ],
      links: [
        ...overlay.links,
        opLink("RUNS", "container:checkout", "deployment:other"),
      ],
    }

    const result = graph.load({ codeGraph, operationalOverlay: ambiguous })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.issues).toContainEqual({
      code: "ambiguous_required_link",
      path: "causalPath[incident=incident:cache-growth,evidence=evidence:heap].container.RUNS",
      message: 'Expected one RUNS link from "container:checkout", found 2',
    })
  })

  test("rejects duplicate code identities and unsupported snapshot schemas", () => {
    const graph = new InMemoryPodoGraph()
    const result = graph.load({
      codeGraph: {
        ...codeGraph,
        schemaVersion: "legacy.code-graph.v0" as "podo.code-graph.v1",
        nodes: [...codeGraph.nodes, codeGraph.nodes[0]!],
      },
      operationalOverlay: overlay,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.issues).toEqual([
      {
        code: "duplicate_node_id",
        path: "codeGraph.nodes[id=code:repo]",
        message: 'Node ID "code:repo" appears more than once',
      },
      {
        code: "unsupported_schema_version",
        path: "codeGraph.schemaVersion",
        message: 'Unsupported code graph schema "legacy.code-graph.v0"',
      },
    ])
  })
})

function codeNode(
  id: string,
  kind: NormalizedCodeGraphSnapshot["nodes"][number]["kind"],
  label: string,
  location?: NormalizedCodeGraphSnapshot["nodes"][number]["location"],
): NormalizedCodeGraphSnapshot["nodes"][number] {
  return {
    id,
    externalId: id.replace("code:", "external:"),
    kind,
    label,
    provenance: "extracted",
    ...(location ? { location } : {}),
  }
}

function codeLink(
  id: string,
  type: NormalizedCodeGraphSnapshot["links"][number]["type"],
  fromNodeId: string,
  toNodeId: string,
): NormalizedCodeGraphSnapshot["links"][number] {
  return {
    id,
    externalId: id.replace("link:", "external:"),
    type,
    fromNodeId,
    toNodeId,
    fromExternalId: fromNodeId.replace("code:", "external:"),
    toExternalId: toNodeId.replace("code:", "external:"),
    provenance: "extracted",
  }
}

function opLink(
  type: OperationalGraphOverlay["links"][number]["type"],
  fromNodeId: string,
  toNodeId: string,
): OperationalGraphOverlay["links"][number] {
  return { type, fromNodeId, toNodeId }
}
