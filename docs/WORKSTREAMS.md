# Rootline workstreams

The team works by module ownership rather than by a shared task queue. Each workstream owns a coherent boundary and delivers through pull requests.

## 1. Core and Codex runtime

**Primary paths**

- `apps/core`
- `packages/codex-app-server-client`
- `packages/codex-protocol`
- `vendor/codex`

**Owns**

- Codex app-server process lifecycle and stdio transport;
- generated protocol compatibility;
- incident, investigation, approval, remediation, and audit orchestration;
- health/readiness contracts;
- isolated checkout and test execution boundaries.

This workstream must not move Codex protocol handling into UI clients.

## 2. CLI and TUI

**Primary paths**

- `apps/cli`
- `apps/tui`
- `packages/client`

**Owns**

- scriptable commands and stable machine-readable output;
- OpenTUI interaction model, keyboard behavior, and terminal rendering;
- typed access to Rootline core.

This workstream consumes core contracts. It does not own incident or approval decisions.

## 3. Dashboard

**Primary path**

- `apps/dashboard`

**Owns**

- incident list and detail surfaces;
- causal graph and evidence timeline;
- diagnosis, diff, tests, approvals, and audit presentation;
- responsive and accessible browser UI.

The dashboard must remain a client of core and must not access persistence or Codex directly.

## 4. Domain modules and plugins

**Primary paths**

- `packages/contracts`
- `packages/domain`
- `packages/plugin-sdk`
- `plugins`
- module directories under `apps/core/src/modules`

**Owns**

- domain and producer/consumer contracts;
- Graphify, OpenTelemetry replay, and GitHub capabilities;
- plugin registration, lifecycle, capability checks, and audit integration.

Contract changes require coordination with every affected producer and consumer.

## 5. Scenarios, evals, and benchmarks

**Primary paths**

- `scenarios`
- `evals`
- `benchmarks`
- `tests`
- `demo`

**Owns**

- deterministic incident corpus;
- quality and safety scorers;
- latency, stability, token, resource, and cost measurement;
- reproducible baselines and judge-facing replay.

Eval and benchmark code must exercise public contracts rather than bypassing core internals.

## Shared-change protocol

Before changing another workstream:

1. describe the required contract change;
2. identify producer and consumer impact;
3. agree on the contract shape;
4. land the smallest shared contract change;
5. validate both sides;
6. keep unrelated implementation in separate pull requests.

## Starting a Codex thread

Give each thread one owned workstream and a concrete acceptance contract:

```text
Workstream:
Owned paths:
Goal:
Primary observable signal:
Acceptance criteria:
Commands to validate:
Paths that must not be changed:
```

The thread must read the nearest `AGENTS.md` before editing and report both primary and secondary validation.
