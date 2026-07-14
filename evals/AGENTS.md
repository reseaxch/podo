# Evals workstream

Own product-quality and safety evaluation.

- Use `scenarios` as the canonical fixture corpus.
- Prefer deterministic scoring for evidence IDs, graph paths, schemas, tests, approvals, and delivery gates.
- A model judge may score narrative quality only as a secondary signal.
- Record model, prompt, Codex version, protocol hash, scenario version, timing, tokens, tools, and result.
- Do not turn benchmark latency into a correctness claim.

Validate with:

```sh
bun run --cwd evals typecheck
bun test evals
bun run eval
```
