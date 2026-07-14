# Benchmarks

This workstream measures runtime properties: latency, stability, resource use, token use, cost, and run-to-run variance.

Benchmark areas are split into Codex app-server, incident replay, investigation, remediation, and end-to-end flow. They reuse canonical fixtures from `scenarios` and exercise public system contracts rather than internal shortcuts.

```sh
bun run --cwd benchmarks typecheck
bun test benchmarks
bun run bench
```

Raw output belongs in `benchmarks/results`; only reviewed aggregate baselines should be committed. A fast run is not evidence that the result is correct—quality gates live in `evals` and correctness gates in `tests`.
