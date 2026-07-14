# Domain ownership

- Keep logic framework-independent, deterministic, and testable.
- Add only real incident, evidence, autonomy, remediation, or safety rules.
- Do not move orchestration, HTTP, persistence, or Codex transport into this package.
- Avoid generic helpers and premature abstractions.
- Make invariants explicit and cover branching rules with narrow tests.
- Coordinate changes that affect serialized contracts with `packages/contracts` owners.

Validate with:

```sh
bun run --cwd packages/domain typecheck
bun run --cwd packages/domain build
```
