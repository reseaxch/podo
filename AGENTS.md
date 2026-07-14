# AGENTS.md

This file applies to the entire repository. A deeper `AGENTS.md` may add narrower instructions for its subtree.

## Product contract

Rootline must demonstrate one evidence-backed flow:

```text
incident → evidence → root cause → tested fix → pull request
```

Read `README.md`, `docs/MVP_PLAN.md`, and the relevant section of `docs/USE_CASES.md` before non-trivial work.

## Architecture invariants

- `apps/core` owns incident state, evidence selection, approvals, remediation orchestration, and audit history.
- CLI, TUI, and dashboard are clients. They must not query persistence directly or invoke Codex directly.
- Codex app-server is a required runtime, not a plugin. Integration belongs in `packages/codex-protocol`, `packages/codex-app-server-client`, and the Codex runtime boundary inside core.
- Generated Codex protocol artifacts must come from the pinned Codex version and must not be hand-edited.
- `plugins` contains replaceable external adapters such as Graphify, OpenTelemetry replay, and GitHub.
- `packages/contracts` is the producer/consumer boundary. Contract changes require validation of every directly affected client and server path.
- `scenarios` is the canonical incident-fixture source for demo, evals, and benchmarks. Do not duplicate scenario data across those areas.
- `tests`, `evals`, and `benchmarks` remain separate: correctness, decision quality, and performance are different signals.

## Collaboration rules

- Keep changes scoped to the assigned workstream and preserve unrelated work.
- Prefer a vertical slice through existing boundaries over parallel placeholder implementations.
- Do not add a second source of truth for incident, evidence, approval, or agent-run state.
- Do not introduce generic shared helpers or framework layers before a real repeated need exists.
- New production dependencies require explicit approval.
- Use pull requests for collaboration. Do not mutate production or merge remediation changes directly into the default branch.
- Keep investigation artifacts under `.scratch/`; do not place temporary files in the repository root.

## Validation

- Define the primary observable signal for each non-trivial change.
- Run the smallest meaningful tests first, then contract, integration, eval, or benchmark suites appropriate to the changed boundary.
- A diagnosis is not valid without evidence references.
- A remediation is not successful unless its regression test fails before the patch and passes after it.
- Failed validation must be reported clearly and must never be converted into a pull request by the product flow.

## Current repository state

The repository currently contains an architecture scaffold and product documentation only. Do not invent setup, build, test, or deployment commands until the corresponding toolchain is committed and verified.
