# First-party plugins

Plugins are replaceable adapters between Podo core and external systems.

| Plugin | Responsibility |
| --- | --- |
| `graphify` | Import and normalize code graph data |
| `otel-replay` | Replay deterministic telemetry and incident signals |
| `github` | Read repository context and deliver approved PRs or issues |

Plugins implement capabilities from `@podo/plugin-sdk`. They must keep provider-specific payloads at the boundary, preserve provenance, and make side effects attributable through core.
