# Codex App Server client

`@podo/codex-app-server-client` is Podo's long-lived integration with `codex app-server --stdio`.

It owns JSONL framing, request correlation, initialization, timeouts and cancellation, child-process supervision, bounded diagnostics, notifications, server-initiated requests, approval response shapes, and the runtime adapter used by core.

It does not own incidents, Podo approval policy, persistence, retries of failed investigations, or client-facing API contracts.

`StartCodexThreadInput.developerInstructions` is an optional internal runtime
field mapped directly to both `thread/start` and `thread/resume`. Core uses it to
install trusted policy separately from turn input; it is not a Podo public
request field.

```sh
bun test packages/codex-app-server-client
bun run --cwd packages/codex-app-server-client typecheck
bun run codex:smoke
```

The direct App Server path is the interactive runtime. The pinned TypeScript SDK currently lacks the required long-lived approval, user-input, steer, and server-request surface.
