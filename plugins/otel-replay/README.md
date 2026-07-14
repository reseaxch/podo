# OpenTelemetry replay plugin

`@rootline/plugin-otel-replay` owns deterministic replay of normalized logs, traces, metrics, deployments, and container signals into Rootline.

Replay may accelerate scenario time, but event order, identifiers, and expected outcomes must remain reproducible across runs.

```sh
bun run --cwd plugins/otel-replay typecheck
bun run --cwd plugins/otel-replay build
```

The package is currently a capability scaffold.
