# Incidents

Owns detection, incident lifecycle state, and transitions into investigation.

The current `IncidentMonitor` proves the deterministic telemetry-to-incident
foundation for the cache-growth scenario. It opens an incident only when one
service/deployment has all of the following evidence:

- at least four strictly increasing `process.heap.used` samples in canonical
  byte units (`By`);
- at least 128 MiB total growth and a latest sample of at least 512 MiB;
- at least two corroborating error/critical runtime failures.

Partial or noisy signals return `hold_for_more_evidence`; healthy input returns
`ignore_healthy`. Neither path creates incident state. Incident and evidence IDs
are content-derived, so replaying the same telemetry does not duplicate state.

Core exposes this state through `GET /api/incidents` and
`GET /api/incidents/:id`. Incident reads project the current linked investigation
status when one exists. The monitor also resolves each incident evidence record
back to its normalized telemetry event for the core-owned investigator prompt;
this internal provenance API is not exposed to clients.

Clients start the transition through `@podo/client`, never this module
directly, and cannot submit replacement prompt text or evidence.

## GitHub Actions Build Incidents

`BuildIncidentRegistry` is the Core-owned source of truth for the UC-13 build
flow. It accepts a normalized `workflow_run` signal, calls an injected
read-only Actions capture port, and validates the returned run, job, and step
bindings before creating evidence. Incident and evidence identifiers are
content-derived, so webhook delivery retries and concurrent duplicate signals
cannot create a second incident or investigation.

The registry automatically starts the shared `InvestigationService` with the
Core-configured absolute repository path, a read-only sandbox, and deny-all
runtime approvals. Only validated public evidence is included in the prompt;
provider responses and Codex errors are never copied into API-facing failure
messages. A completed diagnosis must satisfy the structured diagnosis contract,
cite only supplied evidence IDs, and name the workflow-owned affected service.

Retry and remediation services project their state back through the registry's
finite mutation methods. Those methods enforce monotonic transitions and bind
successful CI results to either the exact next attempt of the failed run or the
stored tested-remediation head and artifact. This keeps incident, evidence,
resolution, and verified-CI state in one authoritative record while the shared
audit store retains the ordered lifecycle history.
