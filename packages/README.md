# Shared packages

Packages hold stable boundaries reused by applications and plugins.

| Package | Responsibility |
| --- | --- |
| `contracts` | Public Podo transport and event shapes |
| `client` | Typed client for the Podo core API |
| `domain` | Framework-independent domain and safety rules |
| `plugin-sdk` | Plugin manifests, capabilities, and lifecycle contracts |
| `codex-protocol` | Generated types and schemas for the pinned Codex version |
| `codex-app-server-client` | Supervised Codex App Server transport and runtime adapter |

Shared packages should remain small and purpose-specific. Read the package README and nearest `AGENTS.md` before changing a boundary used by another workstream.
