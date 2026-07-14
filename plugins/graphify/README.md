# Graphify plugin

`@rootline/plugin-graphify` owns import and normalization of Graphify code graphs into Rootline's graph boundary.

The adapter must retain external IDs, source locations, relation types, schema compatibility, and provenance such as extracted, inferred, or ambiguous. Repeated imports should be idempotent.

```sh
bun run --cwd plugins/graphify typecheck
bun run --cwd plugins/graphify build
```

The package is currently a capability scaffold.
