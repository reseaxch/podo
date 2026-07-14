# Repository scripts

This directory contains supported developer and maintenance commands that operate across workspaces.

The current `codex-upstream.ts` command reports or updates the pinned Codex upstream, regenerates protocol artifacts, and validates the handshake through the repository workflow.

```sh
bun run codex:upstream:status
bun run codex:upstream:update
```

Application runtime behavior belongs in its owning application or package, not in repository scripts.
