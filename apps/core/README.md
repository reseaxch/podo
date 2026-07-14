# Rootline core

`@rootline/core` is the authoritative service boundary. It owns investigation lifecycle, approval state, ordered runtime events, readiness, and the mapping between Rootline investigations and Codex threads/turns.

## Current foundation

- health and Codex readiness endpoints;
- start, read, cancel, and approve investigation commands;
- ordered SSE event delivery with bounded replay;
- fail-closed approvals and explicit crash handling;
- controlled lazy replacement of a failed Codex runtime.
- core-owned settings plus telemetry ingestion and incident read APIs;
- deterministic, replay-safe cache-growth incident detection.

Durable persistence, automatic investigation handoff, graph-backed evidence, remediation, audit, and delivery remain workstream milestones.

## Run and validate

```sh
bun run dev:core
bun run --cwd apps/core typecheck
bun test apps/core
```

Core consumes stable Codex behavior from `@rootline/codex-app-server-client` and exposes Rootline contracts rather than raw Codex JSON-RPC.
