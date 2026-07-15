# Core workstream

Own `apps/core` and the orchestration modules below it.

- Keep HTTP/transport code thin; domain decisions belong to the owning module.
- Use `@podo/codex-app-server-client` for Codex protocol behavior.
- Do not expose raw Codex JSON-RPC directly to clients.
- Preserve approval, audit, sandbox, and failed-test delivery gates.
- Start behavioral changes with a contract-level or handler-level failing test.

Validate with:

```sh
bun run --cwd apps/core typecheck
bun test apps/core
```
