# Podo typed client

`@podo/client` is the shared client-side boundary for core. It owns URL handling, request/response decoding, command methods, and ordered SSE consumption.

Current methods cover settings, telemetry ingestion, incident reads, and investigation start/read/cancel/approve/deny/event subscription. `startIncidentInvestigation(incidentId, { cwd })` is the safe product entrypoint: it cannot accept caller-authored prompt, evidence, sandbox, mode, or approval fields. Raw Codex protocol details must never appear in this package's public API.

```sh
bun test packages/client
bun run --cwd packages/client typecheck
bun run --cwd packages/client build
```

Contract changes require matching producer validation in `apps/core` and consumer validation in the affected CLI, TUI, or dashboard.
