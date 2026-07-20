# Demo

This directory owns the judge-facing, one-command demonstration of Podo's canonical flow:

```text
incident replay → causal graph → evidence-backed diagnosis → approved tested fix → delivery approval → pull request
```

The default runner starts one connected production Dashboard and deterministic
Core composition. Core owns graph bootstrap, telemetry replay, incident state,
diagnosis, both approvals, isolated remediation, regression and validation,
delivery, issue fallback, and audit history. The deterministic Codex and GitHub
ports make the presentation repeatable without external writes; they do not
replace Core or duplicate scenario data.

## Prerequisites

- Bun `1.3.10` and workspace dependencies installed with `bun install`;
- the pinned Codex app-server available as `codex`, or through `CODEX_BIN`;
- ports `3000` and `4100` available on loopback.

## Run

```sh
bun run demo
```

The command first checks the pinned Codex app-server, builds the Dashboard for
production, starts Core, bootstraps the canonical graph, replays telemetry, and
then opens the production incident route backed by `@podo/client`. Any failed
readiness or build check stops the command and cleans up child processes.

Open the printed incident URL and follow the visible flow:

1. start the evidence-backed investigation;
2. review the validated diagnosis and causal graph;
3. request remediation and explicitly approve its isolated checkout;
4. inspect the red-to-green regression result, validation, and sealed diff;
5. explicitly approve delivery and reach the pull-request result.

The terminal success signal is `Podo judge demo is ready`. The final UI success
state is `Open PR #1842`. The local GitHub adapter validates the exact sealed
artifact and performs no network or repository writes. To exercise the
negative path, run `PODO_DEMO_OUTCOME=validation_failure bun run demo`; failed
validation exposes issue fallback and never exposes PR delivery.

The Dashboard and Core stay attached to the terminal. Press Ctrl-C once to stop
both. The runner owns and removes its temporary git checkout and remediation
worktrees, so a later run starts from canonical fixtures again.

For a finite CI or judge preflight, use:

```sh
bun run demo:verify
```

It runs the same readiness checks, prints the canonical incident URL, then
stops its Core and Dashboard children before exiting. Any unknown argument is
rejected before the runner starts a child process.

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

This mode uses the production Core, the real Codex runtime with its default
`gpt-5.6-sol` model, scenario-owned graph bootstrap, and approval-gated
production remediation. A live model may correctly decide that the available
evidence is insufficient for a verified code fix and stop without remediation
or a pull request; therefore it is a diagnostic mode, not the deterministic
judge presentation. GitHub delivery and issue writes remain disabled.
`PODO_DEMO_CORE_PORT`, `PODO_DEMO_SCRATCH_PARENT`, and `PODO_DEMO_BASE_REF`
configure this mode; judge runs should keep the default deterministic mode.

## Live service lab

Use the live lab when the presentation should begin with real application
traffic instead of a preloaded telemetry fixture:

```sh
# terminal 1: Podo Core + Dashboard + checkout + inventory + worker
bun run lab

# terminal 2: sustained checkout traffic that triggers the defect
bun run lab:load
```

`bun run lab` starts the actual demo TypeScript services. Every successful
checkout reserves stock through `inventory-service`, retains a unique session
in the defective in-memory cache, enqueues an HTTP notification job, and
exports normalized metric, trace, and log events to the real Core ingestion
endpoint. `notification-worker` drains those jobs asynchronously.
`bun run lab:load` sends 14 real HTTP requests: 11 grow the cache and 3 reach
the controlled pressure boundary and return HTTP 500. The command verifies all
11 notifications were delivered, Core detects the resulting evidence, and the
exact incident URL is printed for the Dashboard.

The lab retains 2 MiB per checkout locally, but reports a
production-equivalent 42 MiB heap contribution per retained session. This keeps
the laptop-safe process under roughly 25 MiB of intentional retained payload
while preserving the canonical detector thresholds and the same 17-evidence
incident used by the recorded scenario. The traffic, inventory calls, cache
retention, HTTP failures, telemetry ingestion, detection, investigation,
approval gates, regression, and delivery flow all execute; only the heap scale
and external GitHub delivery are deterministic demo boundaries.

For another clean take, stop terminal 1 with Ctrl-C and restart both commands.
The runner removes only its own temporary remediation checkout. Optional port
overrides are:

```sh
PODO_LAB_DASHBOARD_PORT=3030 \
PODO_LAB_CORE_PORT=4130 \
PODO_LAB_CHECKOUT_PORT=8181 \
PODO_LAB_INVENTORY_PORT=8182 \
PODO_LAB_NOTIFICATION_PORT=8183 \
bun run lab
```

Pass the corresponding URLs to the load command when ports are overridden:

```sh
PODO_LAB_DASHBOARD_URL=http://127.0.0.1:3030 \
PODO_LAB_CORE_URL=http://127.0.0.1:4130 \
PODO_LAB_CHECKOUT_URL=http://127.0.0.1:8181 \
PODO_LAB_NOTIFICATION_URL=http://127.0.0.1:8183 \
bun run lab:load
```
