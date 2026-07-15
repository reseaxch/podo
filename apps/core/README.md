# Podo core

`@podo/core` is the authoritative service boundary. It owns investigation lifecycle, approval state, ordered runtime events, readiness, and the mapping between Podo investigations and Codex threads/turns.

## Current foundation

- health and Codex readiness endpoints;
- start, read, cancel, and approve investigation commands;
- ordered SSE event delivery with bounded replay;
- fail-closed approvals and explicit crash handling;
- controlled lazy replacement of a failed Codex runtime.
- core-owned settings plus telemetry ingestion and incident read APIs;
- deterministic, replay-safe cache-growth incident detection.
- incident-scoped, evidence-backed investigator handoff through the typed client.

`POST /api/incidents/:id/investigation` is the product investigation entrypoint.
It accepts only an absolute repository `cwd`; core selects the incident evidence,
compiles the investigator policy prompt, fixes the sandbox to `read-only`, and
retains the incident-to-investigation link. `observe` mode rejects the start,
while `recommend` and `act_with_approval` may draft a diagnosis without granting
mutation authority. Runtime approval requests from this investigator path are
denied by core rather than exposed for approval.

After the matching Codex turn completes, incident reads validate the assembled
final text against `podo.diagnosis.v1`, the incident's affected service, and the
core-owned evidence IDs. The public incident then exposes either a validated
diagnosis or a stable failure state; raw model output is never included in that
projection and no diagnosis field authorizes remediation.

Durable persistence, graph-backed enrichment, remediation, audit, and delivery
remain workstream milestones.

## Run and validate

```sh
bun run dev:core
bun run --cwd apps/core typecheck
bun test apps/core
```

Core consumes stable Codex behavior from `@podo/codex-app-server-client` and exposes Podo contracts rather than raw Codex JSON-RPC.
