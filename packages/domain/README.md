# Podo domain

`@podo/domain` is reserved for framework-independent incident, evidence, autonomy, remediation, and safety rules that are genuinely shared across owning modules.

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

## Structured diagnosis boundary

`parseStructuredDiagnosis(finalText, evidence)` is the fail-closed boundary for
an investigator's final Codex text. It accepts a string containing exactly one
JSON object and returns a discriminated success or an ordered list of structured
errors. The v1 shape is closed to unknown fields:

```json
{
  "schemaVersion": "podo.diagnosis.v1",
  "summary": "...",
  "affectedService": "...",
  "probableRootCause": "...",
  "confidence": { "value": 8750, "scale": "basis_points" },
  "evidenceIds": ["ev-metric-1"],
  "recommendedAction": "...",
  "safeToAttemptFix": false
}
```

Confidence is an integer from `0` to `10000`, inclusive. Evidence IDs must be
non-empty, safe, unique, and known in the supplied `PromptEvidence`; the parser
delegates final citation/provenance checks to `validateEvidenceClaims`.
Injection-shaped strings remain inert field values. A successful parse is not an
approval and does not authorize remediation: orchestration must separately apply
the autonomy, approval, sandbox, and regression policies.
