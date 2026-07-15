# TUI workstream

Own the interactive terminal client built with OpenTUI React.

- Use Bun for the native renderer.
- Keep data access behind `@podo/client`.
- Keep Podo plugins separate from OpenTUI renderer slots.
- Preserve keyboard escape paths and terminal resize behavior.
- Use the OpenTUI test renderer for observable UI behavior.

Validate with:

```sh
bun run --cwd apps/tui typecheck
bun run --cwd apps/tui build
```
