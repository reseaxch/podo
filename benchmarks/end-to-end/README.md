# End-to-end benchmarks

`canonical-core-client-flow.ts` measures the canonical cache-growth scenario
through the public Core handler and typed client:

```text
telemetry detection
  → validated investigation
  → approved isolated red-green remediation
  → approved deterministic pull-request delivery
```

The benchmark runs three independent iterations by default and reports raw
samples plus minimum, maximum, mean, population variance, and standard deviation
for detection, investigation, remediation, delivery, and full-flow latency. It
fails closed if observable counters drift, if investigation is not strictly
under 60 seconds, or if the full measured flow is not strictly under 150
seconds.

Fixture loading, graph bootstrap, and disposable repository setup happen before
the full-flow timer. Codex diagnosis/remediation runtimes and pull-request
delivery are deterministic local ports; the flow performs no network or
external repository writes. Canonical graph and telemetry inputs are read
directly from `scenarios/cache-growth`.

Run it as part of the benchmark CLI:

```sh
bun run bench
```
