# Graph

Owns the operational overlay and graph queries used by incident investigation.

`InMemoryPodoGraph` is the minimal POC owner. One atomic `load` combines a
`NormalizedCodeGraphSnapshot` from `@podo/contracts` with operational nodes for
commits, deployments, containers, telemetry events, incidents, and evidence.
Rejected candidates never replace the previously loaded graph.

The supported operational relations form this evidence-backed query:

```text
Incident --SUPPORTED_BY--> Evidence
Evidence --DERIVED_FROM--> TelemetryEvent
TelemetryEvent --OBSERVED_IN--> Container
Container --RUNS--> Deployment
Deployment --USES--> Commit
Commit --CHANGED--> File
File --CONTAINS--> Function
```

`resolveCausalPath({ incidentId, evidenceId })` returns a content-derived stable
path only when every required hop is unique. Missing, dangling, wrong-kind, and
ambiguous links fail closed; the query never selects an arbitrary candidate.
Multiple evidence items per incident are supported by querying the specific
evidence identity.

`constructIncidentOperationalOverlay` is the pure incident-to-overlay boundary.
It accepts a real detected incident, its normalized telemetry evidence, and an
explicit trusted deployment correlation containing deployment, container,
commit SHA, and changed normalized file-node identities. It requires one
unambiguous telemetry event per evidence reference and exact service,
timestamp, kind, deployment, and container provenance before emitting the six
operational link kinds above. A telemetry commit ID is optional because the
trusted deployment correlation is authoritative, but when present it must
match. The `CHANGED` target comes only from that trusted correlation; telemetry
cannot select a file.

Current limits are deliberate: the graph is an in-memory full replacement, not
persistence or an incremental upsert engine; `CHANGED` must identify one file and
that file must contain one candidate function for the selected evidence path.
Operational overlay construction is not wired into the incident monitor yet.
The raw NetworkX-shaped Graphify fixture also requires a separate versioned
raw-to-`NormalizedCodeGraphSnapshot` decoder before it can be loaded here.

```sh
bun test apps/core/src/modules/graph
bun run --cwd apps/core typecheck
bun run --cwd apps/core build
```
