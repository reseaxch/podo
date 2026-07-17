// UC-13 evaluation harness.
//
// Drives the real UC-13 Build Incident flow through the PUBLIC Core handler
// (createCoreHandler) wired with the real public GitHub plugin adapters over an
// in-memory fake `fetch`, a deterministic diagnosis runtime double, and a fake
// in-memory PR delivery port. No real network, no real GitHub write.
//
// Adapted from apps/core/src/build-incidents.integration.test.ts
// (createFixtureGitHubTransport / createFixture / completeDiagnosis), with a
// configurable delivered head SHA so the foreign-head negative case can be
// driven end-to-end.

import { createHmac } from "node:crypto"
import { fileURLToPath } from "node:url"

import type { BuildIncident } from "@podo/contracts"
import {
  GitHubActionsReadAdapter,
  GitHubActionsRetryAdapter,
  GitHubActionsWebhookDecoder,
} from "@podo/plugin-github"
import { createCoreHandler, type CoreHandlerOptions } from "@podo/core"

import type { LoadedFixtures } from "./fixtures"

// Derive the Codex runtime contract from Core's own public option type rather
// than importing @podo/codex-app-server-client directly, so the eval package
// takes no extra workspace dependency for a type-only need.
type CoreRuntime = NonNullable<CoreHandlerOptions["runtime"]>
type CoreRuntimeEvent = Parameters<Parameters<CoreRuntime["onEvent"]>[0]>[0]
type CoreThreadInput = Parameters<CoreRuntime["startThread"]>[0]

const repositoryCwd = fileURLToPath(new URL("../../../", import.meta.url))
const webhookSecret = "uc13-eval-webhook-secret"
const githubToken = "uc13-eval-github-token"
const operatorIdentity = "uc13-eval-operator"

// A foreign delivered head, distinct from both the canonical remediation head
// (d…d) and the failed source head (c…c). Its CI run exists but does not match
// the delivered remediation, so Core verification fails closed.
export const FOREIGN_DELIVERED_HEAD_SHA = "f".repeat(40)

export interface GitHubWrite {
  url: string
  method: string
}

export type CoreHandler = ReturnType<typeof createCoreHandler>

export interface HttpResult<T> {
  status: number
  body: T
}

class DiagnosisRuntime implements CoreRuntime {
  private readonly listeners = new Set<(event: CoreRuntimeEvent) => void>()
  readonly threads: CoreThreadInput[] = []
  readonly prompts: string[] = []

  async startThread(input: CoreThreadInput) {
    this.threads.push(structuredClone(input))
    return { threadId: "uc13-eval-thread" }
  }

  async resumeThread() { return { threadId: "uc13-eval-thread" } }

  async startTurn(_threadId: string, prompt: string) {
    this.prompts.push(prompt)
    return { turnId: "uc13-eval-turn" }
  }

  async steerTurn() { return { turnId: "uc13-eval-turn" } }
  async interruptTurn() {}
  async resolveApproval() {}

  onEvent(listener: (event: CoreRuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: CoreRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  async close() {}
}

export interface JournalledRequest {
  url: string
  method: string
  pathname: string
  expected: boolean
}

interface FixtureTransport {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  writes: GitHubWrite[]
  listedHeads: string[]
  requests: JournalledRequest[]
  unexpectedRequests: JournalledRequest[]
}

// Validates the exact head-list pagination the public GitHubActionsReadAdapter
// sends (head_sha + per_page=100 + page=1, and nothing else). A malformed or
// drifted query fails closed rather than being served an empty CI list.
function headListQueryIsWellFormed(url: URL): boolean {
  const params = url.searchParams
  return [...params.keys()].sort().join(",") === "head_sha,page,per_page"
    && params.get("per_page") === "100"
    && params.get("page") === "1"
}

// Fake GitHub transport. Serves the canonical fixtures by exact path. EVERY
// request is recorded in a journal BEFORE it is handled — including unexpected
// requests and unexpected writes — so an escape is observable even if Core
// catches the adapter error. Unexpected requests are additionally collected in
// `unexpectedRequests` and the fetch still throws (fail-closed on both fronts).
function createFixtureGitHubTransport(fixtures: LoadedFixtures): FixtureTransport {
  const { failureRun, failureJobs, retrySuccessRun, remediationSuccessRun } = fixtures
  const repository = {
    owner: failureRun.repository.owner.login,
    name: failureRun.repository.name,
  }
  const runsPath = `/repos/${repository.owner}/${repository.name}/actions/runs`
  let currentRun: unknown = structuredClone(failureRun)
  const currentAttempt = failureRun.run_attempt
  const writes: GitHubWrite[] = []
  const listedHeads: string[] = []
  const requests: JournalledRequest[] = []
  const unexpectedRequests: JournalledRequest[] = []

  const record = (url: URL, method: string, expected: boolean): void => {
    const entry: JournalledRequest = { url: url.toString(), method, pathname: url.pathname, expected }
    requests.push(entry)
    if (!expected) unexpectedRequests.push(entry)
  }

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if (method === "GET" && url.pathname === `${runsPath}/${failureRun.id}`) {
      record(url, method, true)
      return Response.json(currentRun)
    }
    if (method === "GET"
      && url.pathname === `${runsPath}/${failureRun.id}/attempts/${currentAttempt}/jobs`) {
      record(url, method, true)
      return Response.json(failureJobs)
    }
    if (method === "POST" && url.pathname === `${runsPath}/${failureRun.id}/rerun-failed-jobs`) {
      record(url, method, true)
      writes.push({ url: url.toString(), method })
      currentRun = { ...retrySuccessRun, run_attempt: currentAttempt + 1 }
      return new Response(null, { status: 201 })
    }
    if (method === "GET" && url.pathname === runsPath) {
      const headSha = url.searchParams.get("head_sha") ?? ""
      const wellFormed = headListQueryIsWellFormed(url) && (
        headSha === remediationSuccessRun.head_sha
        || headSha === FOREIGN_DELIVERED_HEAD_SHA
      )
      // ONLY the canonical remediation head (positive flow) and the explicit
      // foreign-head control are expected. A missing, old/source, unknown head,
      // or a malformed pagination query is a drifted provider request: record it
      // as an escape and fail closed rather than hide it as an empty CI list.
      if (!wellFormed) {
        record(url, method, false)
        throw new Error(`unexpected fixture GitHub request: ${method} ${url.pathname}?${url.searchParams.toString()}`)
      }
      record(url, method, true)
      listedHeads.push(headSha)
      // A matching successful remediation run exists ONLY for the exact
      // delivered remediation head (d…d).
      if (headSha === remediationSuccessRun.head_sha) {
        return Response.json({ total_count: 1, workflow_runs: [remediationSuccessRun] })
      }
      // A foreign delivered head (f…f) DOES have a CI run, but it does not match
      // the delivered remediation (different branch). This drives Core's real
      // `ci_result_mismatch` terminal state — a genuine foreign-CI mismatch,
      // not a Core change.
      return Response.json({
        total_count: 1,
        workflow_runs: [{
          ...remediationSuccessRun,
          id: remediationSuccessRun.id + 1,
          head_sha: headSha,
          head_branch: "main",
          html_url: `https://github.com/${repository.owner}/${repository.name}/actions/runs/${remediationSuccessRun.id + 1}`,
        }],
      })
    }
    // Any unmatched request — path, method, unexpected write — is recorded as an
    // escape before throwing, so it is observable even if Core catches the error.
    record(url, method, false)
    if (method !== "GET") writes.push({ url: url.toString(), method })
    throw new Error(`unexpected fixture GitHub request: ${method} ${url.pathname}`)
  }

  return { fetch, writes, listedHeads, requests, unexpectedRequests }
}

export interface Harness {
  handler: CoreHandler
  runtime: DiagnosisRuntime
  writes: GitHubWrite[]
  listedHeads: string[]
  // Read-only journal of every GitHub request the fake transport saw.
  requests: readonly JournalledRequest[]
  // Requests that did not match any known fixture mapping (path/method/write).
  unexpectedRequests: readonly JournalledRequest[]
  // The injected GitHub transport fetch, exposed so tests can prove that an
  // unexpected request is journaled (fail-closed) even though it also throws.
  githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  repositoryIdentity: string
  webhookBody: string
  completeDiagnosis(incident: BuildIncident): void
  request<T>(path: string, init?: RequestInit): Promise<HttpResult<T>>
  signedWebhook(deliveryId: string): RequestInit
}

export interface HarnessOptions {
  // Head SHA the fake PR delivery port reports as the delivered remediation head.
  // Defaults to the canonical remediation head; the foreign-head negative case
  // passes a distinct value that has no matching successful CI run.
  deliveredHeadSha?: string
}

export function createHarness(fixtures: LoadedFixtures, options: HarnessOptions = {}): Harness {
  const { failureRun, remediationSuccessRun } = fixtures
  const repository = {
    owner: failureRun.repository.owner.login,
    name: failureRun.repository.name,
  }
  const repositoryIdentity = `${repository.owner}/${repository.name}`
  const deliveredHeadSha = options.deliveredHeadSha ?? remediationSuccessRun.head_sha

  const runtime = new DiagnosisRuntime()
  const transport = createFixtureGitHubTransport(fixtures)
  const decoder = new GitHubActionsWebhookDecoder({ secret: webhookSecret, repository })
  const reader = new GitHubActionsReadAdapter({ token: githubToken, repository, fetch: transport.fetch })
  const retry = new GitHubActionsRetryAdapter({ token: githubToken, repository, fetch: transport.fetch })

  const handler = createCoreHandler({
    runtime,
    githubActions: {
      repository,
      repositoryCwd,
      operatorIdentity,
      verificationTimeoutMs: 60_000,
      decodeWebhook(input) { return decoder.decode(input) },
      captureFailedRun(signal) { return reader.captureFailedRun(signal) },
      getCurrentRun(binding) { return reader.getCurrentRun(binding) },
      listRunsForHead(input) { return reader.listRunsForHead(input) },
      retryFailedJobs(input) { return retry.retryFailedJobs(input) },
    },
    remediationExecutor: {
      async execute(input) {
        const sourceHead = input.incident.expectedBaseCommit
        if (!sourceHead) throw new Error("expected source-bound build remediation")
        return {
          provenance: {
            baseRef: failureRun.head_branch ?? "main",
            baseCommit: sourceHead,
            resultTreeOid: "e".repeat(40),
          },
          patch: {
            summary: "Fix the deterministic workspace regression",
            changedFiles: ["packages/example/src/index.ts", "packages/example/src/index.test.ts"],
            unifiedDiff: [
              "diff --git a/packages/example/src/index.ts b/packages/example/src/index.ts",
              "-old",
              "+fixed",
              "diff --git a/packages/example/src/index.test.ts b/packages/example/src/index.test.ts",
              "-expect(regression).toFail()",
              "+expect(regression).toPass()",
            ].join("\n"),
          },
          regression: {
            test: "bun test packages/example",
            prePatch: "failed",
            postPatch: "passed",
          },
          validation: {
            status: "passed",
            checks: ["bun test packages/example", "bun run --cwd packages/example typecheck"],
          },
          pullRequestPreview: {
            title: "fix(workspace): repair deterministic regression",
            body: "Evidence-backed, red-green tested remediation.",
            baseBranch: failureRun.head_branch ?? "main",
            headBranch: remediationSuccessRun.head_branch ?? "podo/remediation-uc13",
          },
        }
      },
    },
    pullRequestDelivery: {
      expectedRepository: repositoryIdentity,
      operatorIdentity,
      port: {
        async deliver(input) {
          return {
            provider: "github",
            repository: repositoryIdentity,
            number: 42,
            url: `https://github.com/${repositoryIdentity}/pull/42`,
            baseCommit: input.artifact.provenance.baseCommit,
            baseBranch: input.artifact.pullRequestPreview.baseBranch,
            headBranch: input.artifact.pullRequestPreview.headBranch,
            // Configurable: the delivered head under evaluation. A foreign head
            // has no matching successful CI run in the fake transport.
            headSha: deliveredHeadSha,
            artifactId: input.artifact.pullRequestPreview.id,
            proof: {
              providerStatus: "created",
              idempotencyKey: input.deliveryId,
              resultTreeOid: input.artifact.provenance.resultTreeOid,
              patchSha256: input.artifact.patch.sha256,
              validationChecks: [...input.artifact.validation.checks],
              evidenceIds: [...input.artifact.evidenceIds],
              authorization: {
                approvalId: input.authorization.approvalId,
                approvedBy: input.authorization.approvedBy,
                approvedAt: input.authorization.approvedAt,
              },
            },
          }
        },
      },
    },
  })

  function completeDiagnosis(incident: BuildIncident): void {
    runtime.emit({
      kind: "output.delta",
      threadId: "uc13-eval-thread",
      turnId: "uc13-eval-turn",
      text: JSON.stringify({
        schemaVersion: "podo.diagnosis.v1",
        summary: "The workspace job failed in its deterministic regression step",
        affectedService: incident.affectedService,
        probableRootCause: "A repository change introduced a deterministic workspace test failure",
        confidence: { value: 9400, scale: "basis_points" },
        evidenceIds: incident.evidence.map(({ id }) => id),
        recommendedAction: "Retry once if appropriate or deliver the red-green tested remediation",
        safeToAttemptFix: true,
      }),
    })
    runtime.emit({
      kind: "turn.completed",
      threadId: "uc13-eval-thread",
      turnId: "uc13-eval-turn",
      status: "completed",
    })
  }

  async function request<T>(path: string, init?: RequestInit): Promise<HttpResult<T>> {
    const response = await handler(new Request(`http://podo.eval${path}`, init))
    return { status: response.status, body: await response.json() as T }
  }

  function signedWebhook(deliveryId: string): RequestInit {
    const signature = `sha256=${createHmac("sha256", webhookSecret).update(fixtures.webhookBody).digest("hex")}`
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": signature,
      },
      body: fixtures.webhookBody,
    }
  }

  return {
    handler,
    runtime,
    get writes() { return transport.writes },
    get listedHeads() { return transport.listedHeads },
    get requests() { return transport.requests },
    get unexpectedRequests() { return transport.unexpectedRequests },
    githubFetch: transport.fetch,
    repositoryIdentity,
    webhookBody: fixtures.webhookBody,
    completeDiagnosis,
    request,
    signedWebhook,
  }
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}
