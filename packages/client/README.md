# Rootline typed client

`@rootline/client` is the shared client-side boundary for core. It owns URL handling, request/response decoding, command methods, and ordered SSE consumption.

Current investigation methods cover start, read, cancel, approve, deny, and event subscription. Raw Codex protocol details must never appear in this package's public API.

```sh
bun test packages/client
bun run --cwd packages/client typecheck
bun run --cwd packages/client build
```

Contract changes require matching producer validation in `apps/core` and consumer validation in the affected CLI, TUI, or dashboard.
