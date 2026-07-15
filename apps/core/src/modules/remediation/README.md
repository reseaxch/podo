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

Core supplies authoritative incident/diagnosis state and the policy produced by
`@podo/domain`. The executor boundary does not implement Codex production,
persistence, or delivery. Core accepts a completed result only when:

- the unified diff is bounded, structurally valid, and agrees with safe
  repository-relative changed paths;
- the named regression failed before the patch and passed afterward;
- full validation passed with named checks;
- the PR preview is complete and policy allows it.

Only then does the public artifact include the diff, integrity hash, verification
record, and reproducible PR preview. Any exception, malformed result, failed
regression, failed validation, inconsistent paths, or policy denial becomes a
terminal sanitized failure with no artifact or delivery.

## Local verification executor

`LocalWorktreeRemediationExecutor` implements the verification side of that
boundary while keeping patch production injected through
`RemediationPatchProducer`. Configuration is explicit and required: canonical
absolute repository and scratch directories, a trusted base ref, one regression
argv, one or more validation argvs, timeout/output caps, and the producer. No
shell strings are evaluated.

For each run it resolves the trusted ref to a commit, creates a uniquely named
detached worktree beneath the owned scratch parent, and performs this sequence:

1. `writeRegression` changes the isolated checkout.
2. The regression command must exit nonzero before the fix.
3. `applyFix` changes the implementation without changing the regression files.
4. The same regression command must exit zero.
5. Every validation command must exit zero.
6. Git emits the bounded binary diff and exact safe changed-file list; core
   builds a deterministic sanitized PR preview.

The executor snapshots the complete tracked and untracked candidate diff
immediately after `applyFix`. The passing post-patch regression and every
passing validation command must leave that snapshot byte-for-byte unchanged.
Any added, deleted, staged, or modified file fails the attempt with the stable
sanitized `verification_command_mutated_worktree` code; no artifact is returned.

The executor never creates a branch, stages files, stashes, resets, pushes,
merges, or writes to the default worktree. Untracked files are represented with
per-file `git diff --no-index` rather than index mutation. Git override
environment variables are removed,
repository hooks and fsmonitor are disabled, configured clean/smudge/process
filters are rejected, and external diff/textconv execution is disabled for owned
git commands. All subprocesses use `Bun.spawn` argv with bounded output and
timeouts. The generated worktree path never contains incident or producer data.
Only that owned path is force-removed, followed by git worktree metadata pruning,
in `finally` on both success and failure.

The injected producer is the trusted mutation boundary and receives only the
isolated worktree path plus a cloned authoritative remediation context. Its
output is still rejected if it stages changes, escapes the supported relative
path shape, mutates the failing regression during the fix phase, or cannot be
represented by the verified diff contract.

A producer may implement idempotent `dispose` lifecycle cleanup. The executor
invokes it for every worktree attempt before removing the isolated checkout,
including pre-regression and validation failures. A disposal error is sanitized
and never prevents owned worktree cleanup.
