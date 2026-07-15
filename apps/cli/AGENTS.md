# CLI workstream

Own the scriptable Podo client.

- Keep stdout machine-readable for non-help commands.
- Put product decisions in core, not command handlers.
- Use `@podo/client` rather than duplicating HTTP calls.
- Treat exit codes and stable JSON shapes as public contracts.

Validate with:

```sh
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli build
```
