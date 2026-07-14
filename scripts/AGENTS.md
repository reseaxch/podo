# Repository scripts ownership

- Keep scripts non-interactive where practical, explicit about mutations, and safe to rerun.
- Resolve paths from the repository root rather than the caller's shell state.
- Fail on partial updates and provide actionable diagnostics.
- Never print secrets or embed machine-specific credentials.
- Do not add CI, deployment, or release automation unless explicitly requested.
- Keep product runtime logic in applications and packages.

Validate both the no-change/status path and any mutating path in an isolated state before handoff.
