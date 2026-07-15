# Contracts ownership

- Keep contracts transport-focused and free of application framework dependencies.
- Model stable Podo concepts; do not leak Codex thread IDs or protocol messages.
- Prefer additive changes when compatibility matters and remove stale shapes deliberately.
- Identify producers and consumers before changing an exported type.
- Update contract-level tests and validate both sides of the boundary.
- Do not place business decisions here; those belong to core or domain.

Validate with:

```sh
bun run --cwd packages/contracts typecheck
bun run --cwd packages/contracts build
bun test apps/core packages/client
```
