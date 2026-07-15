# Codex protocol artifacts

`@podo/codex-protocol` contains TypeScript types and JSON Schemas generated from the pinned Codex App Server binary, plus compatibility metadata.

Generated files under `src/generated` and `schema` are source artifacts for the rest of the workspace. Do not edit them by hand.

```sh
bun run codex:generate
bun run --cwd packages/codex-protocol typecheck
bun run codex:smoke
```

Protocol refreshes are coupled to the pinned `vendor/codex` revision and must validate the consuming app-server client before integration.
