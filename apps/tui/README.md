# Rootline TUI

`@rootline/tui` is the interactive terminal surface built with OpenTUI React. It will present the same incident, evidence, investigation, approval, and remediation state as the dashboard.

The TUI is a client of core. Keep network access behind `@rootline/client`, product decisions in core, and terminal-specific behavior inside this package.

```sh
bun run dev:tui
bun test apps/tui
bun run --cwd apps/tui typecheck
bun run --cwd apps/tui build
```

Keyboard escape paths, resize behavior, cleanup, and observable rendering are part of this module's contract.
