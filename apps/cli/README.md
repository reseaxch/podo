# Rootline CLI

`@rootline/cli` is the scriptable Rootline client. It is intended for shell workflows, automation, health checks, and reproducible operator commands.

The CLI consumes `@rootline/client`; it does not own workflow decisions or connect to Codex directly. Non-help output and exit codes should remain suitable for automation.

```sh
bun run dev:cli -- health
bun run dev:cli -- incidents list
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli build
```

Add commands only after the corresponding public core/client contract exists.
