# Remediation

Core owns the authoritative remediation lifecycle. `POST
/api/incidents/:incidentId/remediation` accepts exactly `{}` and requires a
validated diagnosis with `safeToAttemptFix=true`, active
`act_with_approval` mode, and an injected executor. Start creates a pending
opaque approval and never executes work.

Approve or deny through `POST
/api/incidents/:incidentId/remediation/approvals/:approvalId`. Denial is terminal
and never calls the executor. Approval targets only `isolated_checkout`; repeated
or concurrent starts and identical decisions return the same run, and executor
invocation is at-most-once.

The executor boundary intentionally has no shell, git, Codex, persistence, or
delivery implementation here. Core supplies authoritative incident/diagnosis
state and the policy produced by `@podo/domain`. Core accepts a completed result
only when:

- the unified diff is bounded, structurally valid, and agrees with safe
  repository-relative changed paths;
- the named regression failed before the patch and passed afterward;
- full validation passed with named checks;
- the PR preview is complete and policy allows it.

Only then does the public artifact include the diff, integrity hash, verification
record, and reproducible PR preview. Any exception, malformed result, failed
regression, failed validation, inconsistent paths, or policy denial becomes a
terminal sanitized failure with no artifact or delivery.
