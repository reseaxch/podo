# Plugins workstream

Own first-party external adapters and plugin capability contracts.

- Plugins expose declared capabilities and do not bypass core.
- Every external side effect must be attributable in the audit trail.
- Keep source-specific payloads at the adapter boundary.
- GitHub write capabilities must preserve approval and test gates.
- Do not add Codex as a plugin; it is a required runtime.
