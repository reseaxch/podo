# Demo

This directory owns the judge-facing, one-command demonstration of Podo's canonical flow:

```text
incident replay → evidence-backed diagnosis → approved tested fix → PR preview
```

The default runner executes the canonical POC gate and then opens the explicit
judge fixture in the dashboard. The proof composes the real graph, replay,
Core, typed client, Codex remediation boundary, isolated worktree, regression
gate, validation, and PR preview. The fixture UI makes that already-proved flow
deterministic and easy to present. It does not contain a second implementation
of Core, scenario data, eval logic, or benchmark logic.

## Prerequisites

- Bun `1.3.10` and workspace dependencies installed with `bun install`;
- a clean clone with the canonical defect present on local `main`;
- the pinned Codex app-server available as `codex`, or through `CODEX_BIN`;
- port `3000` available on loopback.

## Run

```sh
bun run demo
```

The command runs `bun run poc` first. Any failed Codex compatibility, graph,
replay, evidence, remediation, red-to-green regression, validation, or PR
preview assertion stops the command and no dashboard is presented. When the
gate passes, the command starts the dashboard at `/demo` with the explicit,
local-only judge fixture.

Open the printed incident URL and follow the visible flow:

1. start the evidence-backed investigation;
2. review the validated diagnosis and causal graph;
3. request remediation and explicitly approve its isolated checkout;
4. inspect the red-to-green regression result, validation, and sealed diff;
5. stop at the reproducible pull-request preview.

The terminal success signal is `Podo judge demo is ready`. The final UI success
state is a completed remediation with a verified PR preview. GitHub issue and
pull-request writes are deliberately disabled, so the command cannot push a
branch, mutate the default branch, or require a GitHub token.

The Dashboard stays attached to the terminal. Press Ctrl-C once to stop it.
The POC gate owns and removes every remediation worktree; a
later run is safe and starts from the canonical fixtures again.

If the dashboard port is occupied, choose another one:

```sh
PODO_DEMO_DASHBOARD_PORT=4511 bun run demo
```

## Optional live diagnostic mode

The production Core, real incident replay, and live dashboard can be exercised
without fixture state:

```sh
PODO_DEMO_MODE=live bun run demo
```

This mode uses the scenario-owned graph bootstrap and approval-gated production
remediation. A live model may correctly decide that telemetry alone is
insufficient for a code fix and stop at the issue-fallback state; therefore it
is a diagnostic mode, not the deterministic judge presentation. GitHub writes
remain disabled. `PODO_DEMO_CORE_PORT`, `PODO_DEMO_SCRATCH_PARENT`, and
`PODO_DEMO_BASE_REF` configure this mode; judge runs should keep the default
deterministic mode.
