# Rootline contracts

`@rootline/contracts` defines stable producer/consumer shapes for Rootline settings, telemetry, incidents, investigations, approvals, and events.

Contracts should describe Rootline concepts, not transport-library internals or raw Codex JSON-RPC. Keep them serializable and explicit about version-sensitive behavior.

```sh
bun run --cwd packages/contracts typecheck
bun run --cwd packages/contracts build
```

Every contract change must be validated against the owning producer and all directly affected consumers.
