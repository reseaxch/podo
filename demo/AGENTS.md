# Demo workstream

Own the reproducible judge-facing path, not product internals.

- Use `scenarios/cache-growth` as the canonical fixture.
- Compose core, clients, plugins, evals, and benchmarks through their supported interfaces.
- Keep the happy path deterministic and retain explicit failure states.
- Do not hide failed tests, bypass approvals, mutate production, or push to a default branch.
- Keep setup and reset idempotent and suitable for a clean checkout.
- Coordinate missing capabilities with their owning workstream instead of implementing local substitutes.

Validation must include the documented one-command flow and the visible incident-to-delivery outcome.
