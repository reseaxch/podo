# Evaluations

Evals answer whether Rootline made the right, evidence-backed, safe decision. This differs from correctness tests and performance benchmarks.

The workstream owns scenario suites, deterministic scorers, reviewed baselines, and evaluation reports. Canonical incident inputs remain in `scenarios`.

```sh
bun run --cwd evals typecheck
bun test evals
bun run eval
```

Prefer deterministic checks for evidence references, graph paths, output schemas, approval behavior, test outcomes, and delivery gates. Model judging may supplement narrative quality but must not replace those gates.
