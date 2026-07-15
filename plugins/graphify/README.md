# Graphify plugin

`@podo/plugin-graphify` validates and normalizes a Graphify code-graph export into a
complete Podo-owned snapshot. It is a pure adapter boundary: it does not read files,
call Graphify, access storage, or emit network requests. Callers own those concerns and may
persist a successful snapshot atomically.

## External contract

`normalizeGraphifyGraph(input: unknown)` accepts one exact Graphify adapter schema:

```ts
interface GraphifyGraphInput {
  schemaVersion: "1.0"
  graphId: string
  nodes: Array<{
    id: string
    kind: "repository" | "service" | "file" | "function" | "endpoint"
    name: string
    provenance: "extracted" | "inferred" | "ambiguous"
    location?: SourceLocation
  }>
  relations: Array<{
    id: string
    type: "CONTAINS" | "OWNS" | "IMPORTS" | "CALLS" | "EXPOSES"
    from: string
    to: string
    provenance: "extracted" | "inferred" | "ambiguous"
    location?: SourceLocation
  }>
}

interface SourceLocation {
  path: string // normalized repository-relative path
  line: number // positive, one-based
  column?: number
  endLine?: number
  endColumn?: number // requires endLine
}
```

Objects are closed: unknown fields, unsupported versions/kinds/relations/provenance,
malformed source locations, duplicate or conflicting external IDs, and dangling relation
endpoints reject the complete import. A rejection is data, not a partial result:

```ts
{
  ok: false,
  rejection: {
    code: "GRAPHIFY_IMPORT_REJECTED",
    issues: Array<{ code: string; path: string; message: string }>
  }
}
```

Issues are sorted by a locale-independent key so the same invalid payload produces a stable
rejection. The adapter never silently drops an invalid node or relation.

## Normalized snapshot and identity

A successful import returns `podo.code-graph.v1`, retaining every external node/link ID,
relation type, provenance value, and source location. Nodes and links are sorted by external
ID, making the serialized snapshot independent of input array order.

Podo IDs use SHA-256-derived identities:

- node ID: provider + `graphId` + external node ID;
- link ID: provider + `graphId` + external relation ID;
- snapshot ID: the complete canonical normalized content.

Therefore repeated imports are byte-stable, node/link IDs remain stable when their content is
updated, and any normalized content change produces a new snapshot ID. Changing `graphId`
creates a distinct identity namespace.

The normalized node, link, location, provenance, and snapshot types are imported
from `@podo/contracts`. The compatibility aliases exported by this plugin remain
available, but the plugin no longer owns a second Podo graph shape.

## Canonical NetworkX decoder

`decodeGraphifyNetworkxV1(raw, { graphId })` is the strict decoder for
`scenarios/cache-growth/fixtures/graph.json`. The version is explicit in the
function name and `GRAPHIFY_NETWORKX_DECODER_VERSION`; the raw file itself does
not carry a schema-version field.

The decoder:

- requires the canonical undirected, non-multigraph NetworkX envelope;
- validates raw nodes, links, duplicated hyperedge metadata, endpoints,
  confidence values/scores, and identity uniqueness before normalization;
- converts `\` paths to repository-relative `/` paths and `L<n>` to a one-based
  source location;
- maps raw code nodes to file/function nodes, and derives repository/service
  nodes only from an unambiguous `<repository>/services/<service>/...` path;
- maps semantic `_src`/`_tgt` direction for `contains`, `method`, and `calls`;
- maps `EXTRACTED`, `INFERRED`, and `AMBIGUOUS` confidence to the matching Podo
  provenance value;
- creates inferred repository-to-service and service-to-file ownership links;
- passes the decoded payload through `normalizeGraphifyGraph`, retaining the
  stable snapshot and entity identity rules above.

The raw file is an undirected NetworkX export, so `source`/`target` ordering is
not semantic. The decoder verifies those endpoints but uses `_src`/`_tgt` for
relation direction. `references`, `semantically_similar_to`, `rationale_for`,
and compound hyperedges are validated but intentionally not promoted into Podo
code relations. Numeric `confidence_score` is validated from 0 to 1; the stable
Podo contract retains its categorical provenance, not the provider-specific
numeric score.

## Current limitations

The NetworkX decoder intentionally supports only the pinned canonical shape and
the relation subset above. A future raw schema must get a separate versioned
decoder instead of weakening `networkx-v1`. Persistence/upsert, operational
overlay nodes, and graph queries belong outside this package.

```sh
bun test plugins/graphify
bun run --cwd plugins/graphify typecheck
bun run --cwd plugins/graphify build
```
