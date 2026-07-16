# Podo plugin SDK

`@podo/plugin-sdk` defines the manifest, capability, lifecycle, and result contracts used by replaceable external adapters.

Plugins may provide Graphify import, telemetry replay, GitHub CI read/retry, and
GitHub delivery capabilities. Read-only CI evidence and approval-gated CI retry
are declared separately so Core can audit and authorize the external side
effect. Codex is a required runtime and does not belong behind this SDK.

```sh
bun run --cwd packages/plugin-sdk typecheck
bun run --cwd packages/plugin-sdk build
```

The SDK should expose the minimum stable surface required by current plugins and preserve capability checks and audit attribution.
