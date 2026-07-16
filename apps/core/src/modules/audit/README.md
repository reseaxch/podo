# Audit

Owns normalized agent, tool, plugin, approval, test, and delivery events.

The in-memory POC store validates and snapshots every payload, assigns
non-overridable Core metadata, and retains the latest 256 events per incident.
Sequences remain monotonic when older events are evicted.

UC-13 uses the same store for the complete Build Incident chain: signed signal,
captured evidence, investigation and diagnosis, retry or remediation approvals,
tested artifact, delivery, observed CI result, and exact verified outcome.
Only stable identifiers, bindings, decisions, and sanitized failure codes are
accepted; raw webhook/model/provider output, tokens, diffs, and command output
are rejected from this trail.
