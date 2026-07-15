# Graphify plugin ownership

- Keep Graphify-specific schemas and compatibility checks in this adapter.
- Normalize into Podo contracts without discarding provenance or source locations.
- Make imports deterministic and idempotent.
- Reject unsupported schema versions with a clear error before partial import.
- Coordinate normalized graph-shape changes with domain, contracts, core, and eval owners.
- Use representative fixtures and contract tests before integrating a new Graphify version.

Validate with:

```sh
bun run --cwd plugins/graphify typecheck
bun run --cwd plugins/graphify build
```
