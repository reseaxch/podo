# Applications ownership

This file applies to all applications under `apps/`. A deeper `AGENTS.md` adds application-specific rules.

- Keep application boundaries explicit: core is the server; CLI, TUI, and dashboard are clients.
- Put shared transport shapes in `packages/contracts` and shared HTTP behavior in `packages/client`.
- Do not copy orchestration, approval, or safety decisions into presentation clients.
- Coordinate public contract changes with every affected application owner.
- Keep application-local dependencies and scripts in that application's `package.json`.

Validate the changed application with its local commands. For cross-application changes, run `bun run check`.
