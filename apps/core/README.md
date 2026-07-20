# Podo core

`@podo/core` is the authoritative service boundary. It owns investigation lifecycle, approval state, ordered runtime events, readiness, and the mapping between Podo investigations and Codex threads/turns.

## Production Codex model

The production Core composition explicitly sends `model: "gpt-5.6-sol"` on
every Codex `thread/start` and `thread/resume`. Set `PODO_CODEX_MODEL` to
`gpt-5.6-sol` or `gpt-5.6-terra` to select the supported GPT-5.6 runtime model.
Any other value aborts composition with the sanitized error
`invalid_production_codex_model_config`.

The generic runtime contract keeps `model` optional for backward compatibility.
Deterministic tests and demos that inject a `CodexRuntime` directly through
`createCoreHandler` are intentionally not decorated with a production model and
must not be cited as evidence that GPT-5.6 ran. Only the production composition
and App Server `thread/start` request provide that evidence.

## Current foundation

- health and Codex readiness endpoints;
- start, read, cancel, and approve investigation commands;
- ordered SSE event delivery with bounded replay;
- fail-closed approvals and explicit crash handling;
- controlled lazy replacement of a failed Codex runtime.
- core-owned settings plus telemetry ingestion and incident read APIs;
- deterministic, replay-safe cache-growth incident detection.
- repository-bound GitHub Actions failure ingestion, workflow/job/step evidence,
  automatic read-only Build Incident investigation, approved retry, exact-head
  remediation CI verification, and a unified ordered audit;
- incident-scoped, evidence-backed investigator handoff through the typed client.
- approval-gated remediation with a verified public artifact only after a
  failing pre-patch regression, passing post-patch regression, and full
  validation;
- a fail-closed two-turn Codex patch producer and detached-worktree executor
  that never stages, branches, pushes, merges, or mutates the source checkout.

`POST /api/incidents/:id/investigation` is the product investigation entrypoint.
It accepts only an absolute repository `cwd`; core selects the incident evidence,
compiles the investigator policy prompt, fixes the sandbox to `read-only`, and
retains the incident-to-investigation link. `observe` mode rejects the start,
while `recommend` and `act_with_approval` may draft a diagnosis without granting
mutation authority. Runtime approval requests from this investigator path are
denied by core rather than exposed for approval.

After the matching Codex turn completes, incident reads validate the assembled
final text against `podo.diagnosis.v1`, the incident's affected service, and the
core-owned evidence IDs. The public incident then exposes either a validated
diagnosis or a stable failure state; raw model output is never included in that
projection and no diagnosis field authorizes remediation.

`GET /api/incidents/:id/evidence` returns each incident-owned evidence reference
paired with the normalized telemetry event that produced it. This is the
authoritative rich-client boundary for metric values, messages, timestamps, and
runtime identifiers; Core returns `409 evidence_unavailable` instead of a
partial record set when stored provenance cannot be resolved.

`GET /api/incidents/:id/causal-path?evidenceId=...` resolves the versioned
incident-to-function chain for one evidence item. The handler accepts normalized
code graph data and trusted deployment/container/commit/file correlation only
through `CoreHandlerOptions.incidentGraph`; it does not import an adapter or
derive commit/file provenance from telemetry. Unknown incident/evidence returns
404, missing graph configuration returns 503, and unresolved or ambiguous graph
provenance returns 409 without a partial path.
Successful paths include normalized file/function labels, external identities,
and optional source locations rather than opaque graph IDs alone.

Production graph bootstrap is disabled by default. Enable it with an explicit
absolute path to a trusted bootstrap manifest:

```sh
PODO_INCIDENT_GRAPH_ENABLED=true
PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH=/absolute/path/to/scenarios/cache-growth/graph-bootstrap.json
```

Core reads the closed, versioned manifest before opening its HTTP listener,
loads its relative raw Graphify fixture through the strict `networkx-v1`
decoder, resolves every changed-file selector to exactly one normalized file
node, and injects the resulting snapshot and trusted correlations into the
handler. Commit and file provenance is never derived from telemetry. Missing,
relative, unreadable, oversized, malformed, unsupported, ambiguous, or
traversal-shaped configuration aborts startup with the stable sanitized error
`invalid_production_incident_graph_config`. An enabled built Core therefore
requires `PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH`; it never relies on a
source-tree-relative runtime default.

## GitHub Actions Build Incident composition

UC-13 is disabled by default. The complete provider boundary is enabled only
for one configured repository and one Core-owned repository directory:

```sh
PODO_GITHUB_ACTIONS_ENABLED=true
PODO_GITHUB_TOKEN=github_token
PODO_GITHUB_REPOSITORY=owner/repository
PODO_GITHUB_ACTIONS_WEBHOOK_SECRET=webhook_secret
PODO_GITHUB_ACTIONS_REPOSITORY_CWD=/absolute/path/to/repository
PODO_GITHUB_OPERATOR_IDENTITY=local-operator
```

The webhook target is `POST /api/github/actions/workflow-runs`. Core verifies
`X-Hub-Signature-256` over the exact raw body, accepts only a failed completed
`workflow_run` for the configured repository, and re-reads the exact run,
attempt, jobs, and steps before creating incident state. The configured
repository directory—not caller input—is used for the automatic read-only,
deny-all-approvals investigation. Set Core autonomy to `recommend` or
`act_with_approval` before ingestion; `observe` intentionally refuses diagnosis.

`POST /api/build-incidents/:id/retry` creates only a pending approval. The only
write path is approval at
`POST /api/build-incidents/:id/retry/approvals/:approvalId`; Core re-evaluates
policy, seals repository/run/head/attempt and operator attribution, and the
plugin may call only GitHub's failed-jobs retry endpoint. Success is accepted
only from the exact next attempt of that same run and head.

For a tested remediation, the normal isolated checkout and PR delivery gates
remain authoritative. Their Build Incident aliases live under
`/api/build-incidents/:id/remediation...`. CI verification begins only after a
red-green artifact and separately approved delivery expose the exact derived
head. `POST /api/build-incidents/:id/remediation/verification` lists CI runs for
that head and accepts only the original workflow on the delivered branch. The
artifact ID, result tree, branch, head SHA, CI run, approval decisions, and
sanitized failures are retained at `GET /api/build-incidents/:id/audit`.

The source failure fixture is a push to the trusted default branch, so
`PODO_REMEDIATION_BASE_REF` must resolve to that exact failed source commit when
the remediation path begins. Provider tests inject REST fakes; they never use
the configured token, network, or a real GitHub write.

Production remediation is disabled by default. When explicitly configured, the
Core startup composes the detached-worktree executor with the same supervised
Codex runtime used by investigations; it does not start a second app-server
connection. `/api/system` and `/readyz` expose `remediation.configured` without
making remediation availability a process-readiness requirement.

This composition is a local/POC operator capability, not a broad production
rollout gate. Core keeps a minimum in-memory audit boundary for investigation,
remediation, and delivery: request, approval or denial, execution start,
diagnosis outcome, and sanitized verification or delivery success/failure.
`GET /api/incidents/:id/audit` returns the incident-wide investigation,
diagnosis, and issue lifecycle with evidence attribution. It omits raw prompts,
model output, commands, diffs, and provider errors. The in-memory POC retains
the latest 256 immutable events per incident with monotonic sequence numbers.
Observable Codex tool calls are derived only from App Server `item/started` and
`item/completed` notifications. Each public audit step has a Core-owned ID,
ordered `started`, `completed`, or `failed` status, a categorical tool kind, and
bounded content-withheld summaries; raw commands, paths, arguments, patches,
provider results, and Codex item IDs are never copied into the audit. The
generated lifecycle does not provide result content for web search or image
view items, so those terminal summaries explicitly say that details are
unavailable rather than inventing output.
`GET /api/incidents/:id/remediation/audit`
returns the ordered typed events. It records stable Core identifiers, decisions,
sanitized failure codes, and the stable full-artifact ID; it never records raw
Codex output, command output, private runtime IDs, secrets, diffs, or unverified
pull-request content.

Enable it with the following complete, fail-closed configuration:

```sh
PODO_REMEDIATION_ENABLED=true
PODO_REMEDIATION_REPOSITORY_ROOT=/absolute/path/to/repository
PODO_REMEDIATION_BASE_REF=refs/remotes/origin/main
PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH=main
PODO_REMEDIATION_SCRATCH_PARENT=/absolute/path/to/worktrees
PODO_REMEDIATION_REGRESSION_COMMAND='["bun","test","demo/services/checkout-service"]'
PODO_REMEDIATION_VALIDATION_COMMANDS='[["bun","run","typecheck"],["bun","test"]]'
PODO_REMEDIATION_COMMAND_TIMEOUT_MS=120000
PODO_REMEDIATION_TURN_TIMEOUT_MS=90000
PODO_REMEDIATION_MAX_OUTPUT_BYTES=524288
```

Repository and scratch paths must be normalized absolute paths and must not
overlap. The trusted base must be an explicit safe git ref. Commands must be
non-empty JSON argv arrays—shell-shaped strings are rejected. If remediation is
enabled with an incomplete or structurally invalid configuration, Core refuses
to start. Directory existence, canonical paths, repository identity, and the
trusted base ref are revalidated immediately before an isolated worktree is
created; those checks fail the remediation without mutating the source checkout.
The local trusted ref and pull-request base branch are intentionally separate:
for example, Core may resolve `refs/remotes/origin/main` locally while the GitHub
pull request targets `main`.

After verification, `POST /api/incidents/:id/remediation/delivery` creates a
separate pending delivery approval. Approval is the only path that invokes the
configured `PullRequestDeliveryPort`, and repeated or concurrent approval
invokes it at most once. Core passes only the snapshotted artifact, including
its immutable base commit, stable full-artifact ID, delivery ID, and a
Core-authored authorization record containing the opaque approval ID. The
operator configuration binds the port to one expected `owner/repository`;
callers cannot select it. Core accepts only a strictly validated GitHub PR result
whose repository, base commit, base branch, head branch, and artifact ID all
match. Denial, missing verification, changed artifacts, adapter errors, and
invalid results expose no pull-request record or provider output.

Networked GitHub delivery is a separate, disabled-by-default opt-in. A complete
configuration composes the verified Git branch publisher, the delivery bridge,
and the GitHub REST adapter. It can be enabled only together with production
remediation:

```sh
PODO_GITHUB_DELIVERY_ENABLED=true
PODO_GITHUB_TOKEN=github_token
PODO_GITHUB_REPOSITORY=owner/repository
PODO_GITHUB_DEFAULT_BRANCH=main
PODO_GITHUB_OPERATOR_IDENTITY=local-operator
PODO_GITHUB_REMOTE_NAME=origin
PODO_GITHUB_COMMAND_TIMEOUT_MS=120000
PODO_GITHUB_MAX_OUTPUT_BYTES=524288
```

`PODO_GITHUB_DEFAULT_BRANCH` must equal
`PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH`; the publisher reuses the trusted
remediation repository root and scratch parent. Core never accepts repository,
branch, patch, or operator identity from the delivery request. It publishes only
the immutable verified artifact after the separate delivery approval, uses the
Core delivery ID for remote reconciliation, and returns a strictly bound PR
result. Incomplete or inconsistent configuration aborts startup with a stable
sanitized error; disabling the feature constructs no publisher or adapter.

GitHub issue fallback is independently disabled by default. Enable it with the
same token and repository identity:

```sh
PODO_GITHUB_ISSUE_ENABLED=true
PODO_GITHUB_TOKEN=github_token
PODO_GITHUB_REPOSITORY=owner/repository
```

`POST /api/incidents/:id/issue` accepts no caller-authored content. Core permits
it only for a validated diagnosis that is unsafe to remediate or whose
remediation was denied/failed, then seals the diagnosis, evidence IDs, proposed
action, fallback reason, and authorization into an idempotent GitHub request.
Core rejects recognized credential and secret material before invoking the
provider, and accepts success only when the provider result exactly matches the
sealed draft, authorization, incident, repository, URL, and open issue state.
No branch is published and no unverified patch is attached. `GET` on the same
path reads the sanitized delivery state.

The token must have access to the configured repository and permission to push
the derived remediation branch and create pull requests. Durable Core state,
restart-safe reconciliation of the local audit lifecycle, and authenticated
actor identity are still required before broader production use; the configured
operator string is an explicit local/POC attribution, not an authenticated user.

## Run and validate

```sh
bun run dev:core
bun run --cwd apps/core typecheck
bun test apps/core
```

Core consumes stable Codex behavior from `@podo/codex-app-server-client` and exposes Podo contracts rather than raw Codex JSON-RPC.

## Read-only operator chat

Core also owns an opt-in multi-turn chat for dashboard and TUI questions. It
reuses the supervised Codex App Server runtime, but keeps its own opaque public
chat identity and never exports Codex thread/turn IDs. The repository path,
developer instructions, read-only sandbox, and approval policy are Core-owned;
message commands accept only `content` and `clientRequestId`. Every Codex
approval request is denied and the turn fails closed.

Enable production composition with `PODO_AGENT_CHAT_ENABLED=true` and an
absolute `PODO_AGENT_CHAT_CWD`. Startup resolves that path to an existing
canonical directory. `GET /api/agent/readiness` then verifies exact pinned
protocol compatibility and a real App Server connection before returning
`ready`. Chat state and replay logs are bounded and in memory for the local/POC
stage. Core interrupts a chat turn after 90 seconds, and both investigation and
chat SSE streams send comment heartbeats during quiet model work.
