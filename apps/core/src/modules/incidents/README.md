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

HTTP exposure and the transition into the existing investigation orchestrator
are deliberately separate integration work: core remains the only state owner,
and clients must consume the future shared contract rather than this module
directly.
