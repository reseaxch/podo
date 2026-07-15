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

## Current limitation

Schema `1.0` is Podo's explicit compatibility boundary for the MVP; the repository does
not yet contain a pinned upstream Graphify export or official schema fixture. When that
artifact is selected, adapt it into this exact payload (or add a separately tested versioned
decoder) rather than weakening validation. Persistence/upsert, operational overlay nodes, and
graph queries belong outside this package.

```sh
bun test plugins/graphify
bun run --cwd plugins/graphify typecheck
bun run --cwd plugins/graphify build
```
