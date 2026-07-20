# Integrate Podo with your project

This guide connects a real repository to Podo's supported incident workflow:

```text
runtime signal → evidence-backed incident → diagnosis → approved tested fix → pull request
```

It is written for operators integrating the current local POC, not for Podo
contributors running the bundled demo. If you only want to evaluate Podo first,
run `bun run demo` and follow the [demo guide](../demo/README.md).

> [!IMPORTANT]
> Podo currently runs from source as a Bun workspace. It is not published as a
> hosted service, container image, or installable npm package. Core state,
> settings, incidents, and audit history are process-local and are lost on
> restart. The HTTP API has no actor authentication. Keep Core on loopback or
> behind a trusted access layer, and treat this setup as local/POC only.

## Contents

- [What you can connect today](#what-you-can-connect-today)
- [Install and verify Podo](#1-install-and-verify-podo)
- [Start Core and the dashboard](#2-start-core-and-the-dashboard)
- [Choose the autonomy level](#3-choose-the-autonomy-level)
- [Send telemetry](#4-send-telemetry)
- [Add an evidence-backed code graph](#5-add-an-evidence-backed-code-graph)
- [Run a read-only diagnosis](#6-run-a-read-only-diagnosis)
- [Configure tested remediation](#7-configure-tested-remediation)
- [Enable GitHub pull-request delivery](#8-enable-github-pull-request-delivery)
- [Capture failed GitHub Actions runs](#9-capture-failed-github-actions-runs)
- [Operate and troubleshoot](#10-operate-and-verify-the-integration)
- [Security and production-readiness boundary](#security-and-production-readiness-boundary)

## What you can connect today

| Capability                  | Required input                                                            | External write                                   |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| Observe                     | Normalized metric, log, and trace events                                  | None                                             |
| Explain the code path       | A supported Graphify NetworkX export plus reviewed deployment correlation | None                                             |
| Diagnose                    | Codex App Server and a local checkout of the target repository            | None; investigation is read-only                 |
| Prepare a fix               | Regression and validation commands plus an isolated scratch directory     | Only an isolated worktree, after approval        |
| Open a pull request         | A repository-scoped GitHub token and Git remote                           | A derived branch and PR, after a second approval |
| Capture failed Actions runs | A signed `workflow_run` webhook and GitHub token                          | None until an approved retry or remediation      |

The current runtime is deliberately narrow:

- one trusted target repository per Core process for GitHub Actions and delivery;
- TypeScript repositories for the supported Graphify path;
- one built-in runtime detector: sustained `process.heap.used` growth corroborated
  by runtime failures;
- one local Codex App Server supervised by Core;
- no direct production mutation, default-branch push, automatic merge, or
  unapproved remediation.

## Integration path

Use the smallest layer that produces value, then add the next one:

1. **Observe:** run Core and send telemetry until an incident is detected.
2. **Diagnose:** point investigation at a local checkout and enable `recommend`.
3. **Explain:** add a reviewed code graph for a causal path into source code.
4. **Remediate:** configure isolated red-green testing and switch to
   `act_with_approval`.
5. **Deliver:** enable GitHub branch publication and pull-request creation.
6. **Automate intake:** add a signed GitHub Actions webhook for failed builds.

Each layer fails closed. A missing graph does not prevent telemetry ingestion;
an unavailable remediation executor does not prevent diagnosis; failed tests do
not expose pull-request delivery.

## Prerequisites

You need:

- macOS or Linux with Git;
- [Bun](https://bun.sh/) `1.3.10`;
- a local clone of the target repository;
- the `codex` CLI `0.144.5`, matching the version pinned by
  [`packages/codex-protocol/metadata.json`](../packages/codex-protocol/metadata.json),
  authenticated and available on `PATH`, or its absolute path in `CODEX_BIN`;
- test and build tools required by the target repository;
- for GitHub features, an `origin` remote that points to the configured GitHub
  repository and a least-privilege repository token.

Podo and the target repository should be separate directories. The remediation
scratch directory must also be outside both repositories.

Example layout:

```text
~/work/
├── podo/                 # this repository
├── acme-checkout/        # target repository
└── podo-worktrees/       # disposable isolated worktrees
```

## 1. Install and verify Podo

Clone Podo with its pinned Codex source checkout and install the workspace:

```sh
git clone --recurse-submodules git@github.com:reseaxch/podo.git
cd podo
bun install
cp .env.example apps/core/.env.local
```

Core runs with `apps/core` as its working directory, so keep local Core settings
in `apps/core/.env.local`. The file is ignored by Git.

Verify the exact Codex protocol/runtime pairing before investigating a real
repository:

```sh
codex --version
bun run codex:smoke
```

The successful smoke check is the primary signal that Core can start and talk
to the required App Server. Podo rejects both older and newer binaries when
their protocol version differs from `0.144.5`. If the matching `codex` is not on
`PATH`, set an absolute binary path in `apps/core/.env.local`:

```dotenv
CODEX_BIN=/absolute/path/to/codex
```

## 2. Start Core and the dashboard

The safe default binds Core to loopback:

```dotenv
PODO_CORE_HOST=127.0.0.1
PODO_CORE_PORT=4100
PODO_CORE_URL=http://127.0.0.1:4100
```

Start Core in the Podo repository:

```sh
bun run dev:core
```

In another terminal, start the dashboard and explicitly bind investigations to
the target checkout:

```sh
PODO_CORE_URL=http://127.0.0.1:4100 \
PODO_INCIDENT_CWD=/absolute/path/to/acme-checkout \
bun run dev:dashboard
```

For repeated local starts, put the same two variables in the Git-ignored
`apps/dashboard/.env.local` instead of passing them on the command line.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The production dashboard
uses Core data at `/`; the deterministic visual fixture is isolated at `/demo`.

Check the process and runtime separately:

```sh
curl --fail http://127.0.0.1:4100/healthz
curl --fail http://127.0.0.1:4100/readyz
curl --fail http://127.0.0.1:4100/api/system
```

- `/healthz` proves the HTTP process is alive.
- `/readyz` requires the supervised Codex runtime to be ready and returns `503`
  when Core is degraded.
- `/api/system` returns the same system projection with HTTP `200`, including
  `codex` status and whether remediation is configured.

> [!WARNING]
> Core has no general HTTP authentication in the current POC. Do not bind it to
> `0.0.0.0` or expose it directly to the public Internet. A public GitHub webhook
> should terminate at a trusted gateway that forwards only the webhook path.

## 3. Choose the autonomy level

Core starts in `observe`, which permits ingestion and incident detection but
intentionally refuses investigation and mutation. Set the least-powerful mode
required for the workflow:

| Mode                | Behavior                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `observe`           | Ingest telemetry and show incidents only                                     |
| `recommend`         | Add read-only, evidence-backed diagnosis and issue fallback                  |
| `act_with_approval` | Allow remediation, CI retry, and PR delivery only through explicit approvals |

For diagnosis:

```sh
curl --fail-with-body \
  -X PATCH http://127.0.0.1:4100/api/settings \
  -H 'content-type: application/json' \
  -d '{"autonomyMode":"recommend"}'
```

For approved remediation and delivery:

```sh
curl --fail-with-body \
  -X PATCH http://127.0.0.1:4100/api/settings \
  -H 'content-type: application/json' \
  -d '{"autonomyMode":"act_with_approval"}'
```

Settings are in memory. Reapply the selected mode after every Core restart.
You can also change it from the dashboard settings page.

## 4. Send telemetry

Podo currently accepts normalized JSON batches, not native OTLP. Exporters or an
OpenTelemetry Collector must transform source data into this boundary:

```http
POST /api/telemetry/events
Content-Type: application/json
```

```json
{
  "events": [
    {
      "timestamp": "2026-07-20T12:00:00.000Z",
      "kind": "metric",
      "service": "checkout-service",
      "severity": "info",
      "message": "process heap sample",
      "deploymentId": "deploy-2026-07-20.1",
      "commitId": "0123456789abcdef0123456789abcdef01234567",
      "containerId": "checkout-7b9c",
      "metric": {
        "name": "process.heap.used",
        "value": 576716800,
        "unit": "By"
      }
    }
  ]
}
```

### Event contract

| Field          | Required                                | Accepted values                                 |
| -------------- | --------------------------------------- | ----------------------------------------------- |
| `timestamp`    | Yes                                     | ISO-8601 instant with `Z` or an explicit offset |
| `kind`         | Yes                                     | `metric`, `log`, or `trace`                     |
| `service`      | Yes                                     | Non-empty service identity                      |
| `severity`     | Yes                                     | `debug`, `info`, `warn`, `error`, or `critical` |
| `message`      | Yes                                     | Non-empty normalized message                    |
| `deploymentId` | For current incident detection          | Stable deployment identity                      |
| `commitId`     | No                                      | Commit identity associated with the event       |
| `traceId`      | No                                      | Trace correlation identity                      |
| `containerId`  | Required for a graph-backed causal path | Workload/container identity                     |
| `metric`       | For `kind=metric`                       | `{ name, value, unit? }`; value must be finite  |

The response reports `accepted`, `duplicates`, and indexed `rejected` events,
plus the detector reaction and any incident opened by the batch. Event IDs are
content-derived, so retrying an identical batch is safe.

### Produce the current cache-growth incident

The built-in detector groups events by `service` and `deploymentId` and requires:

- at least four strictly increasing `process.heap.used` samples in bytes
  (`unit: "By"`);
- at least 128 MiB total growth;
- a final value of at least 512 MiB;
- at least two `error` or `critical` log/trace messages containing `500`,
  `heap out of memory`, or `allocation failure`.

This copy-paste batch crosses those gates:

```sh
curl --fail-with-body \
  -X POST http://127.0.0.1:4100/api/telemetry/events \
  -H 'content-type: application/json' \
  -d '{
    "events": [
      {"timestamp":"2026-07-20T12:00:00Z","kind":"metric","service":"checkout-service","severity":"info","message":"process heap sample","deploymentId":"deploy-local-1","containerId":"checkout-local-1","metric":{"name":"process.heap.used","value":367001600,"unit":"By"}},
      {"timestamp":"2026-07-20T12:00:15Z","kind":"metric","service":"checkout-service","severity":"info","message":"process heap sample","deploymentId":"deploy-local-1","containerId":"checkout-local-1","metric":{"name":"process.heap.used","value":440401920,"unit":"By"}},
      {"timestamp":"2026-07-20T12:00:30Z","kind":"metric","service":"checkout-service","severity":"info","message":"process heap sample","deploymentId":"deploy-local-1","containerId":"checkout-local-1","metric":{"name":"process.heap.used","value":524288000,"unit":"By"}},
      {"timestamp":"2026-07-20T12:00:45Z","kind":"metric","service":"checkout-service","severity":"info","message":"process heap sample","deploymentId":"deploy-local-1","containerId":"checkout-local-1","metric":{"name":"process.heap.used","value":576716800,"unit":"By"}},
      {"timestamp":"2026-07-20T12:01:00Z","kind":"trace","service":"checkout-service","severity":"error","message":"POST /checkout returned 500","deploymentId":"deploy-local-1","containerId":"checkout-local-1","traceId":"trace-local-1"},
      {"timestamp":"2026-07-20T12:01:01Z","kind":"log","service":"checkout-service","severity":"critical","message":"allocation failure: heap out of memory","deploymentId":"deploy-local-1","containerId":"checkout-local-1","traceId":"trace-local-1"}
    ]
  }'
```

The expected primary signal is:

```json
{
  "reaction": {
    "action": "open_incident",
    "detector": "cache_growth"
  },
  "incident": {
    "status": "detected",
    "affectedService": "checkout-service",
    "deploymentId": "deploy-local-1"
  }
}
```

Confirm it through the API or CLI:

```sh
curl --fail http://127.0.0.1:4100/api/incidents
bun run dev:cli -- incidents list
```

For application code, send batches asynchronously with a short timeout and do
not put Podo availability on the request-serving critical path. The demo
checkout service is the current reference implementation; see
[`demo/services/checkout-service/src/telemetry.ts`](../demo/services/checkout-service/src/telemetry.ts).

## 5. Add an evidence-backed code graph

Telemetry is sufficient to open an incident. A code graph adds the causal path:

```text
incident → evidence → telemetry → container → deployment → commit → file → function
```

Production graph bootstrap is opt-in and fail-closed. It requires:

1. a Graphify NetworkX v1 JSON export;
2. a small, reviewed bootstrap manifest that binds deployment and container
   identities to a trusted commit and exactly one changed file.

The current decoder supports the pinned canonical Graphify shape and derives
service ownership from paths shaped like `<repository>/services/<service>/...`.
Repositories with another layout need an adapter change; use telemetry-only
incidents until their graph can be decoded without ambiguity.

Generate the graph with the same path shape used by the canonical scenario. Run
Graphify from the directory that contains the target repository so exported
paths retain `<repository>/services/<service>/...`:

```sh
cd /absolute/path/to
/graphify acme-checkout/services --directed --no-viz
```

Graphify is an external tool and is not installed by this repository. Preserve
its generated `graphify-out/graph.json` in a trusted operator configuration
directory. For example:

```text
/absolute/path/to/acme-checkout/.podo/
├── graph-bootstrap.json
└── graph.json
```

Create `graph-bootstrap.json` beside the graph:

```json
{
  "schemaVersion": "podo.graph-bootstrap.v1",
  "graphId": "acme-checkout",
  "decoder": "networkx-v1",
  "fixture": "graph.json",
  "trustedCorrelations": [
    {
      "deploymentId": "deploy-2026-07-20.1",
      "containerId": "checkout-7b9c",
      "commitSha": "0123456789abcdef0123456789abcdef01234567",
      "changedFile": {
        "label": "cache.ts",
        "path": "acme-checkout/services/checkout-service/src/cache.ts"
      }
    }
  ]
}
```

Rules that commonly cause startup rejection:

- `PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH` must be normalized and absolute;
- `fixture` and `changedFile.path` must be safe relative `/`-separated paths;
- `commitSha` must be exactly 40 lowercase hexadecimal characters;
- each deployment may appear only once;
- `changedFile.label` and `changedFile.path` must match exactly one decoded file
  node;
- unknown fields and ambiguous correlations reject the complete configuration.

Enable the graph in `apps/core/.env.local`:

```dotenv
PODO_INCIDENT_GRAPH_ENABLED=true
PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH=/absolute/path/to/acme-checkout/.podo/graph-bootstrap.json
```

Restart Core. A successful `/readyz` proves the manifest and graph were accepted.
After a matching incident is detected, request a path for one of its evidence
IDs:

```sh
bun run dev:cli -- incidents path <incident-id> <evidence-id>
```

Treat the manifest as reviewed provenance, not generated telemetry. Regenerate
the graph and review correlations when repository structure or deployment
identity changes.

## 6. Run a read-only diagnosis

Before starting an investigation, confirm:

- `bun run codex:smoke` passes;
- `/readyz` returns `200`;
- autonomy is `recommend` or `act_with_approval`;
- the dashboard's `PODO_INCIDENT_CWD` or the CLI argument is the normalized
  absolute path to the target checkout;
- the checkout contains the repository's trusted developer instructions, such
  as `AGENTS.md`, when applicable.

Start from the dashboard with **Investigate**, or use the CLI:

```sh
bun run dev:cli -- incidents investigate <incident-id> /absolute/path/to/acme-checkout
```

Core owns the evidence, prompt policy, read-only sandbox, and Codex thread. The
client cannot replace incident evidence or grant mutation authority. A diagnosis
is exposed only when it satisfies `podo.diagnosis.v1` and cites evidence IDs
owned by that incident.

Optional read-only operator chat uses the same target repository but has a
separate opt-in configuration:

```dotenv
PODO_AGENT_CHAT_ENABLED=true
PODO_AGENT_CHAT_CWD=/absolute/path/to/acme-checkout
```

It is not a generic coding agent: Core denies command, file-write, permission,
and user-input approvals.

## 7. Configure tested remediation

Remediation is disabled by default. When enabled, Core creates a detached Git
worktree, asks Codex for a regression and minimal fix, and independently enforces
red-to-green validation:

1. the regression command must fail before the fix;
2. the same regression command must pass after the fix;
3. every validation command must pass;
4. the verified diff is sealed before the temporary worktree is removed.

Create a scratch parent outside the Podo and target repositories. Then configure
Core in `apps/core/.env.local`:

```dotenv
PODO_REMEDIATION_ENABLED=true
PODO_REMEDIATION_REPOSITORY_ROOT=/absolute/path/to/acme-checkout
PODO_REMEDIATION_BASE_REF=refs/remotes/origin/main
PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH=main
PODO_REMEDIATION_SCRATCH_PARENT=/absolute/path/to/podo-worktrees
PODO_REMEDIATION_REGRESSION_COMMAND='["bun","test","services/checkout-service"]'
PODO_REMEDIATION_VALIDATION_COMMANDS='[["bun","run","typecheck"],["bun","test"]]'
PODO_REMEDIATION_COMMAND_TIMEOUT_MS=120000
PODO_REMEDIATION_TURN_TIMEOUT_MS=90000
PODO_REMEDIATION_MAX_OUTPUT_BYTES=524288
```

Commands are JSON argument arrays, not shell strings. They run from the isolated
target worktree, with no shell interpolation. The following table demonstrates
the argument encoding; the current end-to-end supported graph path remains a
TypeScript repository:

| Stack  | Regression command example                       | Validation example                           |
| ------ | ------------------------------------------------ | -------------------------------------------- |
| Bun    | `["bun","test","services/checkout-service"]`     | `[["bun","run","typecheck"],["bun","test"]]` |
| npm    | `["npm","test","--","cache.test.ts"]`            | `[["npm","run","typecheck"],["npm","test"]]` |
| pnpm   | `["pnpm","test","cache.test.ts"]`                | `[["pnpm","typecheck"],["pnpm","test"]]`     |
| Python | `["python","-m","pytest","tests/test_cache.py"]` | `[["python","-m","pytest"]]`                 |
| Go     | `["go","test","./internal/cache"]`               | `[["go","test","./..."]]`                    |
| Rust   | `["cargo","test","cache"]`                       | `[["cargo","test"]]`                         |

Use commands already documented and supported by the target repository. Podo
does not install target dependencies inside the isolated worktree. The required
executables and dependency strategy must work from a clean checkout. If a clean
worktree needs dependency bootstrap, commit a narrow wrapper script in the
target repository and configure that script as the command. It may create
ignored dependency artifacts, but verification rejects changes to tracked or
otherwise patch-visible files.

The paths must be canonical absolute paths and the repository and scratch paths
must not overlap. `PODO_REMEDIATION_BASE_REF` must exist locally and identify the
trusted source tree; for GitHub build incidents, it must resolve to the exact
failed source commit when remediation begins.

Restart Core and verify:

```sh
curl --fail http://127.0.0.1:4100/api/system
```

The response must contain:

```json
{
  "remediation": {
    "configured": true
  }
}
```

Set autonomy to `act_with_approval`, then use the dashboard or CLI:

```sh
bun run dev:cli -- incidents remediate <incident-id>
bun run dev:cli -- incidents remediation <incident-id>
bun run dev:cli -- incidents approve-remediation <incident-id> <approval-id>
```

Approval starts isolated execution; it does not authorize GitHub delivery.

## 8. Enable GitHub pull-request delivery

Delivery is a separate, disabled-by-default capability. It can be enabled only
with remediation and requires a second approval after the exact patch and test
results are sealed.

### Create a least-privilege token

Prefer a fine-grained token restricted to the single configured repository.
Grant only the permissions required by the features you enable:

| Feature                   | Fine-grained repository permission |
| ------------------------- | ---------------------------------- |
| Read failed workflow runs | Actions: read                      |
| Retry failed jobs         | Actions: write                     |
| Publish a derived branch  | Contents: write                    |
| Create or reconcile a PR  | Pull requests: write               |
| Create issue fallback     | Issues: write                      |

GitHub documents the current permissions for
[workflow run APIs](https://docs.github.com/en/rest/actions/workflow-runs),
[pull requests](https://docs.github.com/en/rest/pulls/pulls), and
[issues](https://docs.github.com/en/rest/issues/issues). Organization policy may
require approval before a fine-grained token becomes active.

Store the token only in the operator environment or a secret manager. Never
commit `.env`, print the token, or put it in an incident payload.

### Configure delivery

```dotenv
PODO_GITHUB_DELIVERY_ENABLED=true
PODO_GITHUB_TOKEN=github_token
PODO_GITHUB_REPOSITORY=acme/acme-checkout
PODO_GITHUB_DEFAULT_BRANCH=main
PODO_GITHUB_OPERATOR_IDENTITY=local-operator
PODO_GITHUB_REMOTE_NAME=origin
PODO_GITHUB_COMMAND_TIMEOUT_MS=120000
PODO_GITHUB_MAX_OUTPUT_BYTES=524288
```

`PODO_GITHUB_DEFAULT_BRANCH` must equal
`PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH`. The configured remote must resolve
to the same `owner/repository`. Podo publishes only a derived
`podo/remediation-…` branch, never the default branch, and never merges the PR.

After remediation succeeds:

```sh
bun run dev:cli -- incidents deliver <incident-id>
bun run dev:cli -- incidents delivery <incident-id>
bun run dev:cli -- incidents approve-delivery <incident-id> <approval-id>
```

The primary success signal is a validated URL under the configured repository:

```text
https://github.com/acme/acme-checkout/pull/<number>
```

### Optional issue fallback

Issue fallback is independent of PR delivery and is allowed only for a validated
diagnosis that is unsafe to remediate or whose remediation was denied or failed:

```dotenv
PODO_GITHUB_ISSUE_ENABLED=true
PODO_GITHUB_TOKEN=github_token
PODO_GITHUB_REPOSITORY=acme/acme-checkout
```

Core authors and validates issue content from the diagnosis and evidence. The
caller cannot attach an unverified patch or choose another repository.

## 9. Capture failed GitHub Actions runs

Podo can turn a failed `workflow_run/completed` webhook into a repository-bound
Build Incident. It re-reads the exact run, attempt, jobs, and steps from GitHub
before accepting provider evidence.

Configure Core:

```dotenv
PODO_GITHUB_ACTIONS_ENABLED=true
PODO_GITHUB_TOKEN=github_token
PODO_GITHUB_REPOSITORY=acme/acme-checkout
PODO_GITHUB_ACTIONS_WEBHOOK_SECRET=use-a-long-random-secret
PODO_GITHUB_ACTIONS_REPOSITORY_CWD=/absolute/path/to/acme-checkout
PODO_GITHUB_OPERATOR_IDENTITY=local-operator
```

The GitHub token and webhook secret must be different. The repository checkout
path must be normalized and absolute. Set autonomy to `recommend` or
`act_with_approval`; `observe` intentionally refuses automatic diagnosis.

Configure a repository webhook in GitHub:

- **Payload URL:** `https://your-trusted-gateway.example/podo/api/github/actions/workflow-runs`
- **Content type:** `application/json`
- **Secret:** the exact `PODO_GITHUB_ACTIONS_WEBHOOK_SECRET` value
- **Event:** `workflow_run`
- **Accepted action:** `completed`

GitHub documents the [`workflow_run` webhook
payload](https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run).
Podo accepts only failed completed runs for the configured repository and
verifies `X-Hub-Signature-256` over the exact raw request body.

Because the rest of Core is unauthenticated, expose only the webhook path
through the trusted gateway. Forward the raw body and the GitHub event,
delivery, content-type, and signature headers without rewriting them.

The direct Core target behind the gateway is:

```text
POST /api/github/actions/workflow-runs
```

Duplicate GitHub deliveries are idempotent. An approved retry is bound to the
same repository, workflow, run ID, head SHA, and next attempt; Podo calls only
GitHub's failed-jobs retry endpoint.

## 10. Operate and verify the integration

Use this checklist after setup and after configuration changes:

```sh
# Core and Codex
curl --fail http://127.0.0.1:4100/healthz
curl --fail http://127.0.0.1:4100/readyz
curl --fail http://127.0.0.1:4100/api/system

# Policy
curl --fail http://127.0.0.1:4100/api/settings

# Data path
curl --fail http://127.0.0.1:4100/api/incidents
bun run dev:cli -- health
bun run dev:cli -- incidents list
```

The observable integration proof is:

- telemetry returns accepted events with no unexplained rejections;
- a qualifying signal returns `reaction.action=open_incident`;
- the incident appears in the API and dashboard;
- diagnosis names the configured service and cites only stored evidence IDs;
- graph-backed incidents resolve a unique path into a file and function;
- remediation shows a failing pre-patch regression and passing post-patch
  regression plus validation;
- delivery remains unavailable until its separate approval;
- the source checkout and default branch remain unchanged.

For CLI automation, every command uses the typed Core client and preserves
non-zero exits for failures. See the complete command list in
[`apps/cli/README.md`](../apps/cli/README.md).

## Troubleshooting

### `/readyz` returns `503`

Inspect `/api/system`. Confirm `CODEX_BIN` resolves to the pinned version and run
`bun run codex:smoke`. Core can still ingest telemetry while Codex is degraded,
but investigation is unavailable.

### Core exits with `invalid_production_incident_graph_config`

Check the manifest's absolute path, exact closed schema, relative fixture path,
40-character lowercase commit SHA, and exact file label/path match. Disable
`PODO_INCIDENT_GRAPH_ENABLED` to isolate graph configuration from telemetry.

### Telemetry is accepted but no incident opens

Read the returned `reaction.reason`. Confirm all signals share the exact same
`service` and `deploymentId`, heap metrics use `process.heap.used` and `By`, and
the batch crosses every current detector gate.

### Investigation returns `policy_denied`

Core restarted in `observe`. PATCH `/api/settings` to `recommend` or
`act_with_approval` and retry.

### Investigation reads the wrong repository

Set `PODO_INCIDENT_CWD` in the dashboard process, not only in the Core process,
or use the CLI command with an explicit absolute path. For GitHub Actions, Core
always uses `PODO_GITHUB_ACTIONS_REPOSITORY_CWD`.

### Remediation is not configured

Every `PODO_REMEDIATION_*` value is required when remediation is enabled. Verify
that repository and scratch paths exist, are absolute, and do not overlap; the
trusted base ref must resolve locally; commands must be JSON argument arrays.

### Pre-patch regression unexpectedly passes

The configured regression command does not reproduce the diagnosed defect from
the trusted base. Podo correctly stops the workflow. Narrow the command to a
real regression that fails before the patch; never convert this result into a
delivery approval.

### GitHub delivery is rejected

Confirm token permissions, repository identity, remote URL, default/base branch
equality, and that the trusted base has not moved. Podo rejects mismatched
provider responses and never treats a partial delivery as success.

### A restart removed incidents or settings

This is expected in the current POC. Core state and settings are in memory.
Reapply settings and replay telemetry; durable state and restart reconciliation
are prerequisites for broader production use.

## Security and production-readiness boundary

The current safeguards are real: read-only investigation, explicit remediation
and delivery approvals, isolated worktrees, red-green regression enforcement,
closed configuration schemas, repository-bound GitHub operations, no default
branch push, no automatic merge, and sanitized public failures.

They do not replace missing production controls. Before any shared or hosted
deployment, add durable state and reconciliation, authenticated actor identity,
an audited secrets perimeter, transport authentication/TLS, authorization for
every Core route, backup/recovery, and operational monitoring. Until then:

- run one Core process for one trusted operator and repository;
- keep Core on loopback or a private trusted network;
- expose only the signed webhook path through a gateway;
- use repository-scoped, least-privilege, expiring GitHub credentials;
- keep target and scratch paths separate;
- review every approval and validation result before delivery.

## Reference

- [Core configuration and runtime behavior](../apps/core/README.md)
- [Telemetry boundary](../apps/core/src/modules/telemetry/README.md)
- [Incident detector](../apps/core/src/modules/incidents/README.md)
- [Graph model](../apps/core/src/modules/graph/README.md)
- [Graphify adapter](../plugins/graphify/README.md)
- [GitHub adapter](../plugins/github/README.md)
- [Typed client](../packages/client/README.md)
- [CLI commands](../apps/cli/README.md)
- [Dashboard behavior](../apps/dashboard/README.md)
- [Canonical scenario fixtures](../scenarios/cache-growth/README.md)
