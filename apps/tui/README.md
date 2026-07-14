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

## Control surface contract

`RootlineTui` consumes an injected `RootlineTuiViewModel` and `RootlineTuiController`. The future
`@rootline/client` adapter owns network synchronization; the renderer does not call core, persistence,
or Codex directly.

- `Tab` moves focus between the run and settings panels.
- `a`, `d`, and `c` explicitly approve, deny, or cancel while an approval is pending. Approval is
  never selected or submitted by default; modified or key-repeat events are ignored.
- With settings focused, `e` opens an edit draft. `Tab` selects a field, arrow keys or Space change
  it, and Enter or Ctrl-S saves the complete draft. Escape discards it.
- Outside settings editing, `q` or Escape exits cleanly.

The autonomy mode values consumed by the injected model follow the shared wire spelling: `observe`,
`recommend`, and `act_with_approval`. The renderer presents the last value as `act-with-approval`.

The renderer switches from side-by-side panels to a vertical layout below 80 columns.
