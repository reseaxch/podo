# Telemetry

Owns normalized logs, traces, metrics, and deterministic scenario replay.

`InMemoryTelemetryStore` is the current vertical-slice ingestion boundary. It
accepts only ISO-8601 instants with an explicit timezone, normalizes them to UTC,
assigns content-derived event IDs, orders events by time and ID, and makes replay
idempotent. Present optional runtime identifiers and metric units must be
non-empty text. Malformed events are rejected explicitly; they never become
evidence implicitly.

This store is intentionally process-local. A durable adapter can replace it
without moving normalization or incident decisions into HTTP clients.

`POST /api/telemetry/events` is the public batch boundary. It returns accepted,
duplicate, and rejected counts together with the detector reaction and any
incident opened by that batch.
