# Vendored upstream sources

This directory holds upstream source trees pinned for reproducible integration. `vendor/codex` is the OpenAI Codex upstream used to generate protocol artifacts and validate Rootline's App Server boundary.

Treat vendored code as upstream-owned. Rootline integration code belongs in `packages/codex-protocol`, `packages/codex-app-server-client`, and `apps/core`.

Use the supported repository commands to inspect or update the pin:

```sh
bun run codex:upstream:status
bun run codex:upstream:update
```
