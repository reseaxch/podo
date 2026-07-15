# Cross-cutting correctness tests

This directory is reserved for tests that genuinely cross module boundaries:

- `unit` for shared pure behavior without a natural package-local home;
- `contract` for producer/consumer compatibility;
- `integration` for multiple Podo modules working together;
- `e2e` for user-visible system flows.

Prefer colocated tests beside their owning implementation when only one module is involved. Evals measure decision quality and benchmarks measure runtime properties; neither replaces correctness tests.

## Canonical POC integration proof

`integration/canonical-poc.test.ts` is the first complete runnable proof across
the existing Podo boundaries. It reads the canonical cache-growth graph and
telemetry files directly, decodes Graphify NetworkX data, replays telemetry
through the typed client into the real in-process core handler, resolves the
evidence-specific deployment/commit/code path, and projects one validated
diagnosis from a deterministic Codex runtime double.

The test performs no network calls or sleeps. It reads `scenario.json` as the
canonical source for whether an incident is created, which service is affected,
and whether the validated diagnosis is safe to attempt fixing. The only
scenario correlation data supplied outside the fixtures is the trusted
deployment/container/commit mapping and the changed file identity selected
from the normalized graph. Raw Graphify payloads, Codex thread/turn IDs, model
output, and incomplete diagnosis state are asserted not to cross the public
client boundary.

`safeToAttemptFix` is diagnostic output only. Even when the canonical scenario
sets it, the proof asserts that diagnosis completion neither grants approval
nor starts remediation; remediation remains a separate explicit,
approval-gated command.

```sh
bun test tests/integration/canonical-poc.test.ts
bun run test
```
