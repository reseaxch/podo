# Benchmarks workstream

Own latency, stability, resource, token, and cost measurement.

- Reuse canonical scenarios and public system contracts.
- Report multiple runs and variance, not one best sample.
- Keep raw results out of Git; review and commit only intentional aggregate baselines.
- Preserve separate phase timings for detection, investigation, remediation, and delivery.

Validate with:

```sh
bun run --cwd benchmarks typecheck
bun test benchmarks
bun run bench
```
