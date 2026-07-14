# Rootline domain

`@rootline/domain` is reserved for framework-independent incident, evidence, autonomy, remediation, and safety rules that are genuinely shared across owning modules.

It should not become a generic utilities package or a duplicate state authority. Core remains responsible for orchestration and persistence boundaries.

```sh
bun run --cwd packages/domain typecheck
bun run --cwd packages/domain build
```

The package is currently a foundation; add behavior only when a concrete domain rule and its tests justify shared ownership.
