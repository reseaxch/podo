# Typed client ownership

- Keep the API typed against `@rootline/contracts`.
- Centralize HTTP and SSE mechanics here instead of duplicating them in applications.
- Preserve event ordering, reconnect cursors, abort behavior, and useful error decoding.
- Do not add product decisions, persistence access, or raw Codex JSON-RPC.
- Treat exported method names and decoded shapes as public contracts.
- Validate producer and consumer sides when changing a shared command or event.

Validate with:

```sh
bun test packages/client apps/core/src/client.integration.test.ts
bun run --cwd packages/client typecheck
bun run --cwd packages/client build
```
