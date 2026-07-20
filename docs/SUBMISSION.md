# Podo — OpenAI Build Week submission and judge guide

This document is the repository-owned source for the Podo submission copy,
judge setup, demo recording plan, and final Devpost checklist.

## Submission status

| Item                         | Current value                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Hackathon                    | OpenAI Build Week                                                                          |
| Category                     | Developer Tools                                                                            |
| Repository                   | <https://github.com/reseaxch/podo>                                                         |
| Submission deadline          | July 21, 2026 at 5:00 PM Pacific Time                                                      |
| Deterministic judge path     | `bun run demo:verify` followed by `bun run demo`                                           |
| Demo video URL               | **Missing external value — project owner must publish the final public YouTube video**     |
| `/feedback` Codex Session ID | **Missing external value — project owner must provide it from the primary build session**  |
| Repository licensing         | **Owner decision required — the public repository currently has no root license metadata** |

Do not replace either missing external value with a placeholder in Devpost.
Devpost requires a public YouTube video shorter than three minutes and a real
`/feedback` session ID. Devpost also requires a public repository to have
relevant licensing; choosing a license is intentionally outside this
documentation change.

## Judge quickstart

Podo's judge path is a local, deterministic sandbox. It does not need hosted
credentials, an OpenAI API key, or a writable GitHub repository. It performs a
live compatibility handshake with the pinned Codex App Server, then uses
scenario-owned data and deterministic provider boundaries so every judge sees
the same evidence, tested patch, and pull-request preview.

### Prerequisites

- macOS or Linux;
- Git and Node.js/npm;
- ports `3000` and `4100` available on loopback.

Install the exact Bun and Codex CLI versions used by the repository:

```sh
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10"
npm install --global @openai/codex@0.144.5
bun --version
codex --version
```

Expected versions:

```text
1.3.10
codex-cli 0.144.5
```

Clone over HTTPS, including the pinned Codex source submodule, and install the
locked workspace:

```sh
git clone --recurse-submodules https://github.com/reseaxch/podo.git
cd podo
bun install --frozen-lockfile
```

Run the finite preflight first:

```sh
bun run demo:verify
```

It checks the exact Codex version and App Server handshake, builds the
Dashboard, starts the connected Core-backed scenario, prints the incident URL,
and cleans up its child processes. A non-zero exit is a failed preflight.

Then run the interactive judge demo:

```sh
bun run demo
```

Wait for `Podo judge demo is ready`, open the printed local URL, and follow the
visible flow:

1. inspect the detected cache-growth incident, evidence, and causal graph;
2. start the evidence-backed investigation;
3. review the validated diagnosis and evidence references;
4. request remediation and explicitly approve the isolated checkout;
5. inspect the regression failing before the fix and passing after it;
6. review the sealed diff and validation result;
7. approve delivery and reach the `Open PR #1842` preview.

The PR is a reproducible preview: the demo validates the exact sealed artifact
without writing to GitHub or the default branch. Stop the interactive demo with
Ctrl-C. For the fail-closed branch:

```sh
PODO_DEMO_OUTCOME=validation_failure bun run demo
```

Failed validation exposes issue fallback and never enables PR delivery.

## Tested platforms

| Surface                    | Verified environment                                                   | Status                                               |
| -------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Local judge flow           | macOS 26.5, Apple Silicon (`arm64`), Bun `1.3.10`, Codex CLI `0.144.5` | Manually exercised during the hackathon              |
| Workspace and Dashboard CI | GitHub Actions `ubuntu-latest`, Bun `1.3.10`, Chromium Playwright      | Required checks on every PR and push to `main`       |
| Windows                    | Portable path behavior has targeted tests                              | Full install and judge flow not end-to-end validated |
| Browsers                   | Chromium through Playwright                                            | Other browser engines are not claimed as tested      |

## What Podo does

Podo is an incident-to-fix developer tool. It connects runtime telemetry,
deployments, commits, code, and GitHub Actions into one evidence graph. From a
memory-growth or build incident, Podo identifies the affected service, selects
the relevant evidence, validates a structured diagnosis, and prepares a small
tested remediation in an isolated Git worktree. Human approval is required
before remediation and again before pull-request delivery.

The canonical proof is:

```text
incident → evidence → root cause → tested fix → pull request
```

Core is the single state and safety authority. The Dashboard, CLI, and OpenTUI
are typed clients. A model recommendation cannot grant itself permission:
evidence IDs are validated, approval provenance is Core-owned, the regression
must fail before the patch and pass afterward, and failed validation cannot
reach delivery.

## How Codex and GPT-5.6 were used

Podo used Codex with GPT-5.6 in two distinct ways.

### Building Podo

Codex agents running GPT-5.6 were used across module-owned workstreams to
scaffold the Bun monorepo, turn the product contract into typed boundaries,
implement test-first vertical slices, review pull requests, reproduce failures,
and harden safety behavior. Key decisions were captured in code and regressions
rather than left as prompt-only policy:

- `adbfcc4` established the workspace and ownership boundaries;
- `aaf79ba` added the supervised Codex App Server runtime;
- `b45f64c` introduced approval-gated remediation state;
- `b0afa1b` added the isolated worktree and red-green executor;
- `010a2c0` added the fail-closed Codex remediation producer;
- `63fb468` added the one-command judge demo;
- `37b5c09` added the GitHub Actions incident vertical;
- `3997c6b` pinned Codex CLI and generated protocol artifacts to `0.144.5`;
- `177b9b7` added the live three-service incident lab.

The repository history is the durable evidence for where Codex accelerated
implementation and where review changed the design.

### Running Podo

Codex App Server is a required runtime boundary, not a generic plugin. Podo
pins Codex CLI `0.144.5`, generates TypeScript and JSON Schema from that exact
version, maintains one supervised JSONL App Server connection, and maps private
Codex threads, turns, streaming events, and approval requests into stable Podo
contracts.

The default judge demo performs a real App Server version and initialization
handshake, but uses a deterministic runtime double for the remediation turns.
That makes the demo repeatable and offline after readiness while still testing
the production Core orchestration, approval, worktree, regression, diff, and
delivery boundaries. It does **not** claim that the deterministic remediation
turns are live GPT-5.6 inference. `PODO_DEMO_MODE=live bun run demo` exercises
the configured live Codex model and may correctly stop at issue fallback when
the available evidence is insufficient.

## Devpost copy

### Name

Podo

### Tagline

Evidence-backed incident response from runtime signal to a human-approved,
tested pull request.

### Built with

Codex, GPT-5.6, TypeScript, Bun, React, Next.js, OpenTUI, OpenTelemetry,
GitHub Actions, Vitest, and Playwright.

### Project description

#### Inspiration

During an incident, the useful facts are split across metrics, traces, logs,
deployments, commits, CI, and source code. Engineers spend too much time
rebuilding that chain manually, while a chat model given a pile of logs can
produce a plausible answer without proving it.

#### What it does

Podo builds a living evidence graph across those systems. It detects a runtime
or GitHub Actions incident, traces the symptom to the affected deployment,
commit, file, and function, and returns a structured diagnosis whose material
claims cite validated evidence. After explicit approval, Codex prepares a
minimal patch and regression test in an isolated worktree. Podo independently
requires red-before-green behavior and package validation, seals the exact Git
tree, and requires a second approval before producing the matching pull request
or preview. Failed validation goes to issue fallback, never delivery.

#### How we built it

Podo is a Bun and TypeScript monorepo. Core owns incidents, evidence,
investigations, approvals, remediation, delivery, and audit history. The
Dashboard, CLI, and OpenTUI consume the same typed client. OpenTelemetry replay,
Graphify import, and GitHub are replaceable adapters. Codex App Server is the
supervised execution runtime, with generated protocol types pinned to Codex CLI
`0.144.5`.

The deterministic judge scenario reproduces a cache-growth defect across
checkout, inventory, and notification services. It proves the full path from
telemetry to causal graph, evidence-backed diagnosis, approved red-green fix,
sealed diff, and pull-request preview without external writes.

#### How we used Codex and GPT-5.6

We used Codex agents with GPT-5.6 throughout the hackathon to build parallel
module slices, write regressions before fixes, inspect runtime evidence, review
security boundaries, and integrate the product into one vertical flow. Inside
Podo, the same Codex App Server architecture powers investigation and
remediation behind Core-owned approval and validation gates. For judging, Podo
performs a live App Server handshake and uses deterministic remediation turns
so the result is reproducible; an optional live mode exercises the configured
model directly.

#### Challenges

The hard part was not generating a patch. It was preserving evidence integrity
and authority across every boundary: untrusted telemetry and model output,
private Codex protocol state, human approvals, isolated Git worktrees,
red-before-green tests, exact-tree delivery, retries, crashes, and stale client
state.

#### Accomplishments

- one command launches the complete incident-to-PR judge experience;
- the same Core contracts drive Dashboard, CLI, and OpenTUI;
- remediation cannot run without explicit approval;
- a regression must fail before the fix and pass afterward;
- failed validation cannot create a pull request;
- GitHub Actions failures support exact-run retry or tested remediation;
- live service traffic can reproduce the canonical cache-growth incident.

#### What we learned

Agentic reliability comes from keeping authority outside the model. Structured
output helps, but the durable guarantees are trusted evidence references,
typed contracts, fail-closed state transitions, exact artifact identity, and
independent tests.

#### What's next

Durable Core state and restart reconciliation, authenticated actor identity,
complete audit persistence, broader platform testing, and production deployment
hardening.

## Demo video storyboard

Target length: **2:55**. The final upload must be a public YouTube video shorter
than three minutes.

| Time      | Screen                                        | Audio                                                                                                                                                                                                       |
| --------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Title and one-line incident problem           | “Incident evidence is fragmented across runtime, deployments, CI, commits, and code. Podo turns that into one proven path to a tested fix.”                                                                 |
| 0:15–0:30 | Architecture / causal graph overview          | Explain that Core owns evidence and approvals; clients never invoke Codex or storage directly.                                                                                                              |
| 0:30–0:50 | Run `bun run demo`; open printed incident URL | Call out the live Codex `0.144.5` App Server compatibility handshake and deterministic judge composition.                                                                                                   |
| 0:50–1:15 | Incident evidence and graph                   | Follow memory growth through service, deployment, commit, file, and `CheckoutCache`.                                                                                                                        |
| 1:15–1:35 | Validated diagnosis                           | Show confidence and evidence IDs; state that unsupported model claims fail closed.                                                                                                                          |
| 1:35–2:10 | Request and approve remediation               | Show isolated checkout, regression failing before the fix, passing after it, validation, and minimal diff.                                                                                                  |
| 2:10–2:30 | Approve delivery                              | Reach `Open PR #1842`; explain exact-tree sealing and that the judge path performs no GitHub write.                                                                                                         |
| 2:30–2:50 | Git history / concise build montage           | Explicitly say: “We built Podo with Codex agents running GPT-5.6 across parallel, test-first workstreams; Codex accelerated implementation and review, while typed gates kept authority outside the model.” |
| 2:50–2:55 | Closing incident-to-PR flow                   | “Podo: incident, evidence, root cause, tested fix, pull request.”                                                                                                                                           |

Recording checklist:

- show the project working, not only slides;
- keep the terminal version check or handshake visible;
- say both **Codex** and **GPT-5.6** in the audio;
- show both approval boundaries and the red-green test evidence;
- do not show credentials, local private paths, or raw environment values;
- verify the final public upload is under three minutes.

## Exact Devpost checklist

The live OpenAI Build Week form currently requires the following custom fields:

| Field ID | Field                                                                | Required                              | Podo value / owner action                                                   |
| -------- | -------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `27945`  | Submitter Type                                                       | Yes                                   | **External owner choice:** Individual, Team of Individuals, or Organization |
| `27946`  | Country of Residence                                                 | Yes                                   | **External owner value required**                                           |
| `27947`  | Category                                                             | Yes                                   | `Developer Tools`                                                           |
| `27948`  | Public or private code repository URL                                | Yes                                   | `https://github.com/reseaxch/podo`                                          |
| `27949`  | Project URL and judge instructions                                   | No                                    | No hosted instance; use the deterministic local quickstart above            |
| `27950`  | `/feedback` Session ID where the majority of the project was built   | Yes                                   | **Missing external value — project owner must provide**                     |
| `27951`  | Dev tool installation, supported platforms, and testing instructions | Required for Podo as a developer tool | Use the paste-ready text below                                              |

Paste-ready value for field `27949`:

> Podo ships a deterministic local judge sandbox rather than a hosted
> credentialed instance. Clone the public repository and follow
> `docs/SUBMISSION.md#judge-quickstart`. Run `bun run demo:verify`, then
> `bun run demo` and open the printed incident URL. No API key, test account, or
> writable GitHub repository is required.

Paste-ready value for field `27951`:

> Install Bun 1.3.10 and Codex CLI 0.144.5, clone
> `https://github.com/reseaxch/podo` with `--recurse-submodules`, and run
> `bun install --frozen-lockfile`. Use `bun run demo:verify` for the finite
> preflight and `bun run demo` for the interactive incident-to-tested-PR flow.
> The flow is verified locally on macOS 26.5 arm64 and in GitHub Actions on
> `ubuntu-latest`; Chromium is the tested browser. Windows has targeted portable
> path tests but the complete judge flow is not claimed as end-to-end tested.

Global deliverables and project fields:

- [x] Working project and deterministic judge path.
- [x] Project name, tagline, description, and Built With copy.
- [x] Developer Tools category.
- [x] Public repository URL and README setup guidance.
- [x] Sample incident data under `scenarios/cache-growth`.
- [x] Clear Codex and GPT-5.6 build/runtime narrative.
- [x] Developer-tool installation, platform, and test instructions.
- [ ] Public YouTube demo shorter than three minutes.
- [ ] Real `/feedback` Codex Session ID from the primary build session.
- [ ] Submitter type, country, and final team details confirmed by the owner.
- [ ] Relevant repository licensing resolved by the owner; no root license is
      currently declared.

Devpost reports that a website and zip archive are not required. Do not submit
until every unchecked required or eligibility item above is resolved.
