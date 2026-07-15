# GitHub plugin

`@podo/plugin-github` owns GitHub-facing capabilities such as repository context,
commit and diff access, and approved PR or issue delivery.

All writes must remain downstream of core's human approval and test-result gates. This plugin must never merge a PR, push to a default branch, or reinterpret a failed remediation as successful.

```sh
bun run --cwd plugins/github typecheck
bun run --cwd plugins/github build
```

## Pull-request delivery boundary

`GitHubDeliveryAdapter` is the production GitHub REST boundary for an already
verified remediation artifact. Delivery requires all of the following:

- an explicit core authorization with `decision=approved`, opaque approval id,
  actor, and ISO timestamp;
- a stable full artifact id and idempotency key;
- a content SHA-256 covering patch metadata, unified diff, validation, evidence,
  trusted base commit/ref, expected result tree object id, PR copy, and
  non-default head ref;
- an independent SHA-256 of the unified diff;
- `validation.status=passed` with named checks;
- repository owner/name, configured default branch, and exact trusted base ref;
- a derived head ref matching `podo/remediation-[a-f0-9]{16,64}`, different from
  both the default and trusted base.

All runtime validation is fail-closed. Tokens and downstream response bodies or
exceptions are never copied into typed results or `GitHubDeliveryError` values.
Returned PR URLs must exactly match
`https://github.com/{configured-owner}/{configured-repo}/pull/{number}`.
GitHub REST requests are pinned to exactly `https://api.github.com`; alternate
API origins are rejected so the configured bearer token cannot be redirected.

The adapter performs no merge and cannot target the default branch. It calls an
injected `GitHubBranchPublisher` first. That port must idempotently reconstruct
or verify the artifact from the trusted base commit, publish the configured head,
and return the exact resulting head SHA plus the artifact id/content hash/base
commit and result tree it verified. The adapter rejects any mismatch. Only then
does it search all PR states for this delivery's HTML idempotency marker and
require the PR title/body, base ref/SHA, and head ref/SHA to match the sealed
artifact exactly. A missing PR is created once; a 422 race is reconciled through
the same complete check. Concurrent calls in one adapter share one promise, while later calls
republish/verify before trusting an existing PR.

### Integration assumption

Core remains the authority that decides whether delivery is authorized and
constructs the artifact only after pre-patch failure, post-patch success, and
full validation. The narrow handoff required from core is
`GitHubDeliveryRequest`: approval attribution plus the stable artifact identity,
idempotency key, trusted `baseCommit`/`baseRef`, expected `resultTreeOid`, patch
and patch hash, validation, evidence ids, and PR preview.

`GitCliBranchPublisher` is the concrete Git implementation. Wrap it with
`GitCliDeliveryBranchPublisher` when constructing `GitHubDeliveryAdapter`. The
bridge passes only the sealed base commit, unified diff, patch hash, changed-file
set, result tree, derived head, title, and approval timestamp to the Git
publisher, then binds its returned head commit and result tree back to the full
artifact identity. The Git publisher idempotently reconstructs the verified
tree in an owned scratch worktree, verifies the configured GitHub remote and
base commit, and never overwrites or publishes the default branch. New heads use
a create-only `force-with-lease` compare-and-set so a branch raced in by another
actor is left untouched. Network Git commands use the literal verified GitHub
URL with credential helpers, redirects, proxies, URL rewrites, and unrelated
process environment removed from the token-bearing child.

If the default branch moves after the derived head is created, delivery fails
before PR creation but leaves that exact derived head for operator cleanup or a
later reconciliation pass. Durable cleanup/reconciliation remains outside this
POC runtime slice.

Tests use injected REST fakes and local bare Git repositories. They perform no
real network or GitHub writes.
