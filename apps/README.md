# Applications

Runnable Podo surfaces live here. Each application has a narrow role and its own ownership instructions.

| Application | Role |
| --- | --- |
| `core` | Authoritative orchestration service and public API |
| `cli` | Scriptable client with stable machine-readable output |
| `tui` | Interactive terminal client built with OpenTUI |
| `dashboard` | Browser UI for incidents, evidence, approvals, and remediation |

Core owns workflow decisions. CLI, TUI, and dashboard consume public contracts through `@podo/client` and must not invoke Codex or persistence directly.

Read the target application's `README.md` and nearest `AGENTS.md` before editing it.
