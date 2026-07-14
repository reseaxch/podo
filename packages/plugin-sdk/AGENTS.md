# Plugin SDK ownership

- Keep the SDK independent of any single external provider.
- Require explicit capability declarations and auditable operation results.
- Separate read capabilities from write or delivery capabilities.
- Do not let plugins bypass core approval, test, or sandbox gates.
- Add abstractions only when at least one concrete plugin requires them.
- Validate every affected first-party plugin when the SDK changes.

Validate with:

```sh
bun run --cwd packages/plugin-sdk typecheck
bun run --cwd packages/plugin-sdk build
bun run --workspaces --if-present typecheck
```
