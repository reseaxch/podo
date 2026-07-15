# Audit

Owns normalized agent, tool, plugin, approval, test, and delivery events.

The in-memory POC store validates and snapshots every payload, assigns
non-overridable Core metadata, and retains the latest 256 events per incident.
Sequences remain monotonic when older events are evicted.
