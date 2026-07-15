# Dashboard workstream

Own the browser dashboard.

- Prefer Server Components and static rendering until interactivity requires a client boundary.
- Import shared contracts directly; avoid broad barrel modules.
- Fetch through the typed Podo client and do not access storage or Codex directly.
- Preserve loading, empty, error, success, approval, and failed-remediation states.
- Keep the main incident-to-PR flow usable on narrow screens.

Validate with:

```sh
bun run --cwd apps/dashboard typecheck
bun run --cwd apps/dashboard build
```
