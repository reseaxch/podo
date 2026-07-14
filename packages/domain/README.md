# Rootline domain

`@rootline/domain` is reserved for framework-independent incident, evidence, autonomy, remediation, and safety rules that are genuinely shared across owning modules.

It should not become a generic utilities package or a duplicate state authority. Core remains responsible for orchestration and persistence boundaries.

```sh
bun run --cwd packages/domain typecheck
bun run --cwd packages/domain build
```

The package is currently a foundation; add behavior only when a concrete domain rule and its tests justify shared ownership.

## Harness policy

The package exposes the deterministic policy used by core before it offers a tool to an agent:

- `observe` permits evidence and graph reads only;
- `recommend` additionally permits diagnosis, issue, and patch previews, but no execution;
- `act_with_approval` requires explicit approval and an isolated checkout for executable actions;
- a failed regression blocks patch writes and pull-request creation, while a pull request additionally requires a passing regression.

`buildInvestigatorPrompt` and `buildRemediatorPrompt` compile the same policy into system-prompt text and tool allowlists. They are guidance for the model, not the enforcement boundary: callers must still use `evaluateReaction` before executing an action. Evidence IDs are validated separately, and evidence content must be passed through `formatUntrustedEvidence` so data cannot be confused with system instructions. Because formatting is independently callable, callers must obtain a valid result from `validateEvidenceClaims` before including that evidence block in a prompt; duplicate IDs fail validation even when their records are otherwise identical.
