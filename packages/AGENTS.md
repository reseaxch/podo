# Shared packages workstream

Packages define boundaries shared by multiple applications.

- Keep `contracts` transport-focused and `domain` behavior-focused.
- Generated Codex protocol files come only from `bun run codex:generate`.
- The app-server client owns JSON-RPC lifecycle and transport mechanics, not Podo incident decisions.
- Contract changes require producer and consumer tests.
- Avoid generic `shared` or `utils` packages.
