# Codex protocol ownership

- Treat `src/generated` and `schema` as generated output; never patch individual generated files.
- Generate only from a binary matching the pinned upstream revision.
- Keep compatibility metadata synchronized with the generated artifacts.
- Review generation diffs for unexpected method or schema churn.
- Coordinate protocol changes with `packages/codex-app-server-client` and core.
- Do not expose the raw Codex protocol as Podo's public client contract.

Validate with:

```sh
bun run codex:generate
bun run --cwd packages/codex-protocol typecheck
bun test packages/codex-app-server-client
bun run codex:smoke
```
