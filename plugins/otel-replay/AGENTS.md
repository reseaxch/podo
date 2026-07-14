# OpenTelemetry replay ownership

- Use canonical fixtures from `scenarios`; do not create a private scenario corpus here.
- Preserve event order, timestamps, trace links, deployment identity, and provenance.
- Keep replay deterministic under the same scenario version and configuration.
- Make completion and failure explicit; workflows must not hang silently.
- Keep source-specific OTEL payload normalization at this boundary.
- Coordinate public ingestion-shape changes with core, contracts, evals, and benchmarks.

Validate with:

```sh
bun run --cwd plugins/otel-replay typecheck
bun run --cwd plugins/otel-replay build
```
