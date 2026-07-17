// UC-13 plugin contract test.
//
// Binds the canonical raw provider fixtures under
// scenarios/github-actions-failure/fixtures/ directly to the two public plugin
// entry points — GitHubActionsWebhookDecoder.decode and
// GitHubActionsReadAdapter.captureFailedRun — with no Core, no HTTP handler, no
// synthetic payloads, and no real network or write call. It reads the committed
// fixtures directly from scenarios/ and never mutates them.

import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"

import {
  GitHubActionsReadAdapter,
  GitHubActionsWebhookDecoder,
  type GitHubActionsFailureSnapshot,
  type GitHubActionsRunSnapshot,
  type GitHubActionsWebhookSignal,
} from "./index"

const fixtureRoot = new URL(
  "../../../scenarios/github-actions-failure/fixtures/",
  import.meta.url,
)

interface RepositoryPayload {
  name: string
  owner: { login: string }
}

const failureWebhookBody = await readFixtureText("failure-webhook.json")
const failureRun = await readFixtureJson<{ repository: RepositoryPayload }>("failure-run.json")
const failureJobs = await readFixtureJson<unknown>("failure-jobs.json")
const retrySuccessRun = await readFixtureJson<unknown>("retry-success-run.json")
const remediationSuccessRun = await readFixtureJson<unknown>("remediation-success-run.json")

const repository = {
  owner: failureRun.repository.owner.login,
  name: failureRun.repository.name,
} as const

const webhookSecret = "uc13-plugin-contract-webhook-secret"
const token = "uc13-plugin-contract-github-token"
const runId = 91377001
const headSha = "c".repeat(40)
const deliveryId = "uc13-plugin-contract-delivery"
const remediationRunId = 91377002
const remediationHeadSha = "d".repeat(40)

const runsPath = `/repos/${repository.owner}/${repository.name}/actions/runs`

describe("GitHub Actions plugin over canonical UC-13 fixtures", () => {
  test("decodes the real signed failure webhook into the exact repository-bound run signal", () => {
    const decoder = new GitHubActionsWebhookDecoder({ secret: webhookSecret, repository })
    const signal = decoder.decode({
      eventType: "workflow_run",
      deliveryId,
      signatureSha256: `sha256=${createHmac("sha256", webhookSecret).update(failureWebhookBody).digest("hex")}`,
      body: failureWebhookBody,
    })

    expect(signal).toEqual({
      provider: "github",
      event: "workflow_run",
      action: "completed",
      deliveryId,
      repository: { ...repository },
      run: { id: runId, attempt: 1, headSha },
    })
    expect(JSON.stringify(signal)).not.toContain(webhookSecret)
  })

  test("captures the exact failed run, job, and step evidence from the canonical fixtures", async () => {
    const requests: Array<{ url: string; method: string; authorized: boolean }> = []
    const adapter = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input, init) => {
        const url = new URL(String(input))
        requests.push({
          url: url.toString(),
          method: init?.method ?? "GET",
          authorized: new Headers(init?.headers).get("authorization") === `Bearer ${token}`,
        })
        if (url.pathname === `${runsPath}/${runId}`) return Response.json(failureRun)
        if (url.pathname === `${runsPath}/${runId}/attempts/1/jobs`) return Response.json(failureJobs)
        throw new Error(`unexpected fixture GitHub request: ${init?.method ?? "GET"} ${url.pathname}`)
      },
    })

    const capture = await adapter.captureFailedRun(fixtureSignal())

    expect(capture).toEqual({
      schemaVersion: "podo.github-actions.failure.v1",
      deliveryId,
      repository: { ...repository },
      run: {
        id: runId,
        workflowId: 3001,
        workflowName: "Workspace",
        workflowPath: ".github/workflows/ci.yml",
        runNumber: 77,
        attempt: 1,
        event: "push",
        headBranch: "main",
        headSha,
        status: "completed",
        conclusion: "failure",
        createdAt: "2026-07-16T08:00:00.000Z",
        updatedAt: "2026-07-16T08:04:00.000Z",
        url: `https://github.com/${repository.owner}/${repository.name}/actions/runs/${runId}`,
      },
      jobs: [
        {
          id: 81001,
          runId,
          attempt: 1,
          headSha,
          name: "Workspace",
          status: "completed",
          conclusion: "failure",
          startedAt: "2026-07-16T08:00:10.000Z",
          completedAt: "2026-07-16T08:03:40.000Z",
          steps: [
            {
              number: 1,
              name: "Install dependencies",
              status: "completed",
              conclusion: "success",
              startedAt: null,
              completedAt: null,
            },
            {
              number: 2,
              name: "Run workspace tests",
              status: "completed",
              conclusion: "failure",
              startedAt: null,
              completedAt: null,
            },
          ],
        },
        {
          id: 81002,
          runId,
          attempt: 1,
          headSha,
          name: "Dashboard",
          status: "completed",
          conclusion: "success",
          startedAt: "2026-07-16T08:00:10.000Z",
          completedAt: "2026-07-16T08:02:40.000Z",
          steps: [],
        },
        {
          id: 81003,
          runId,
          attempt: 1,
          headSha,
          name: "Codex compatibility",
          status: "completed",
          conclusion: "success",
          startedAt: "2026-07-16T08:00:10.000Z",
          completedAt: "2026-07-16T08:01:40.000Z",
          steps: [],
        },
      ],
    } satisfies GitHubActionsFailureSnapshot)

    const failedJob = capture.jobs.find((job) => job.conclusion === "failure")
    expect(failedJob).toMatchObject({ id: 81001, name: "Workspace" })
    expect(failedJob?.steps.find((step) => step.conclusion === "failure")).toEqual({
      number: 2,
      name: "Run workspace tests",
      status: "completed",
      conclusion: "failure",
      startedAt: null,
      completedAt: null,
    })

    expect(requests).toEqual([
      {
        url: `https://api.github.com${runsPath}/${runId}`,
        method: "GET",
        authorized: true,
      },
      {
        url: `https://api.github.com${runsPath}/${runId}/attempts/1/jobs?per_page=100&page=1`,
        method: "GET",
        authorized: true,
      },
    ])
    expect(JSON.stringify(capture)).not.toContain(token)
  })
})

describe("GitHub Actions plugin over canonical UC-13 success fixtures", () => {
  test("normalizes the retry-success fixture as the same run with its successful second attempt", async () => {
    const requests: Array<{ url: string; method: string; authorized: boolean }> = []
    const adapter = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: fixtureFetch(requests, `${runsPath}/${runId}`, retrySuccessRun),
    })

    const current = await adapter.getCurrentRun({ repository, runId, headSha })

    expect(current).toEqual({
      id: runId,
      workflowId: 3001,
      workflowName: "Workspace",
      workflowPath: ".github/workflows/ci.yml",
      runNumber: 77,
      attempt: 2,
      event: "push",
      headBranch: "main",
      headSha,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-16T08:00:00.000Z",
      updatedAt: "2026-07-16T08:09:00.000Z",
      url: `https://github.com/${repository.owner}/${repository.name}/actions/runs/${runId}`,
    } satisfies GitHubActionsRunSnapshot)
    expect(requests).toEqual([
      { url: `https://api.github.com${runsPath}/${runId}`, method: "GET", authorized: true },
    ])
    expect(JSON.stringify(current)).not.toContain(token)
  })

  test("normalizes the remediation-success fixture as a completed run on its distinct remediation head", async () => {
    const requests: Array<{ url: string; method: string; authorized: boolean }> = []
    const adapter = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: fixtureFetch(requests, `${runsPath}/${remediationRunId}`, remediationSuccessRun),
    })

    const current = await adapter.getCurrentRun({
      repository,
      runId: remediationRunId,
      headSha: remediationHeadSha,
    })

    expect(current).toEqual({
      id: remediationRunId,
      workflowId: 3001,
      workflowName: "Workspace",
      workflowPath: ".github/workflows/ci.yml",
      runNumber: 78,
      attempt: 1,
      event: "pull_request",
      headBranch: "podo/remediation-0123456789abcdef",
      headSha: remediationHeadSha,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-16T08:10:00.000Z",
      updatedAt: "2026-07-16T08:14:00.000Z",
      url: `https://github.com/${repository.owner}/${repository.name}/actions/runs/${remediationRunId}`,
    } satisfies GitHubActionsRunSnapshot)
    expect(current.headSha).not.toBe(headSha)
    expect(requests).toEqual([
      { url: `https://api.github.com${runsPath}/${remediationRunId}`, method: "GET", authorized: true },
    ])
    expect(JSON.stringify(current)).not.toContain(token)
  })
})

function fixtureFetch(
  requests: Array<{ url: string; method: string; authorized: boolean }>,
  expectedPath: string,
  payload: unknown,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = new URL(String(input))
    requests.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      authorized: new Headers(init?.headers).get("authorization") === `Bearer ${token}`,
    })
    if ((init?.method ?? "GET") === "GET" && url.pathname === expectedPath) return Response.json(payload)
    throw new Error(`unexpected fixture GitHub request: ${init?.method ?? "GET"} ${url.pathname}`)
  }
}

function fixtureSignal(): GitHubActionsWebhookSignal {
  return {
    provider: "github",
    event: "workflow_run",
    action: "completed",
    deliveryId,
    repository: { ...repository },
    run: { id: runId, attempt: 1, headSha },
  }
}

async function readFixtureText(name: string): Promise<string> {
  return Bun.file(new URL(name, fixtureRoot)).text()
}

async function readFixtureJson<T>(name: string): Promise<T> {
  return Bun.file(new URL(name, fixtureRoot)).json() as Promise<T>
}
