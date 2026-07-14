# Rootline plugin SDK

`@rootline/plugin-sdk` defines the manifest, capability, lifecycle, and result contracts used by replaceable external adapters.

Plugins may provide Graphify import, telemetry replay, and GitHub delivery capabilities. Codex is a required runtime and does not belong behind this SDK.

```sh
bun run --cwd packages/plugin-sdk typecheck
bun run --cwd packages/plugin-sdk build
```

The SDK should expose the minimum stable surface required by current plugins and preserve capability checks and audit attribution.
