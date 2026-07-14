# Codex app-server client

Own the stable stdio integration with Codex app-server.

- Follow the initialize/initialized handshake before other methods.
- Keep experimental protocol fields disabled unless a use case explicitly requires them.
- Stream notifications without dropping ordering or approval events.
- Make timeouts, child-process exits, and malformed JSON observable.
- Regenerate protocol artifacts whenever the pinned Codex revision changes.

Validate with:

```sh
bun test packages/codex-app-server-client
bun run codex:smoke
```
