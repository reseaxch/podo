# Cross-cutting test ownership

- Test public behavior and contracts rather than private implementation structure.
- Keep narrow module tests colocated with their source; use this directory for true cross-boundary coverage.
- Make fixtures deterministic and reuse canonical incident inputs from `scenarios`.
- Do not call real write-capable external services by default.
- Preserve explicit coverage for approvals, failed tests, sandbox boundaries, and delivery gates.
- Keep e2e assertions focused on observable outcomes and actionable failure output.

Run the narrowest relevant suite first, then `bun run check` for changes spanning workstreams.
