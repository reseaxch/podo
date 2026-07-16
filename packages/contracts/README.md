# Podo contracts

`@podo/contracts` defines stable producer/consumer shapes for Podo settings, telemetry, incidents, investigations, approvals, events, and normalized code graphs.

An incident may include an additive `investigation` link with its public status.
`StartIncidentInvestigationRequest` contains only `cwd`; investigator prompt,
evidence, sandbox, mode, and approval remain core-owned and are not part of the
transport contract.

After a linked investigation reaches a terminal state, an incident may include
an additive `diagnosis`. The `validated` variant is the closed
`podo.diagnosis.v1` transport shape. The `failed` variant contains only a stable
error code/message and intentionally has no raw output or `safeToAttemptFix`.
Absence means no terminal diagnosis has been projected yet. Diagnosis safety is
informational and never represents remediation approval.

## Incident remediation

The incident remediation contract is core-owned and fail-closed. Starting a
remediation accepts no caller-authored diagnosis, evidence, policy, target, or
executor result. It creates an opaque human approval in `pending_approval`; only
the separate approve command may move the run into execution. Denial is terminal.

A completed remediation contains a reproducible, sanitized artifact: the
repository-relative changed-file list, validated unified diff and its SHA-256,
the required pre-patch failure/post-patch pass, full validation checks, and a PR
preview. Pending, denied, running, and failed remediations never contain an
artifact or PR preview. Raw Codex IDs, output, commands, and protocol messages
are not transport fields.

Contracts should describe Podo concepts, not transport-library internals or raw Codex JSON-RPC. Keep them serializable and explicit about version-sensitive behavior.

## Agent chat

The additive agent-chat contract exposes readiness, an opaque chat identity,
typed user/assistant history, bounded ordered SSE events, cancellation, and
stable public failure codes. Creation accepts no configuration, and a message
contains only `content` plus `clientRequestId`. Repository paths, policy,
sandbox, approvals, Codex thread/turn IDs, commands, and protocol messages are
intentionally absent. A failed turn never retains partial output in chat
history; live deltas remain bounded turn events.

## Normalized code graph

`NormalizedCodeGraphSnapshot` is the boundary between a source adapter and the
core graph owner. Schema `podo.code-graph.v1` contains repository, service, file,
function, and endpoint nodes plus typed links. Every node and link retains its
source identity, provenance (`extracted`, `inferred`, or `ambiguous`), and optional
repository-relative source location.

This contract is already normalized Podo data. It is not the raw Graphify format.
In particular, `scenarios/cache-growth/fixtures/graph.json` is a NetworkX node-link
export with `directed`, `multigraph`, free-form nodes, and `source`/`target` links;
passing it directly as `NormalizedCodeGraphSnapshot` is unsupported. The
Graphify adapter's versioned decoder converts that source payload before core
receives the normalized snapshot.

`GetIncidentCausalPathResponse` exposes the evidence-specific
`podo.causal-path.v1` chain as explicit incident, evidence, telemetry event,
container, deployment, commit, file, and function identities. The transport
includes normalized file/function labels, external IDs, and optional source
locations so consumers can render code-level evidence. It does not expose graph
implementation details, provider payloads, or a partial path.

```sh
bun run --cwd packages/contracts typecheck
bun run --cwd packages/contracts build
```

Every contract change must be validated against the owning producer and all directly affected consumers.
