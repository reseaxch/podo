import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"

import {
  GitHubActionsError,
  GitHubActionsReadAdapter,
  GitHubActionsRetryAdapter,
  GitHubActionsWebhookDecoder,
  githubPluginManifest,
  type GitHubActionsRetryRequest,
  type GitHubActionsWebhookSignal,
} from "./index"

const token = "github-actions-token-never-expose"
const webhookSecret = "github-webhook-secret-never-expose"
const repository = { owner: "reseaxch", name: "podo" } as const
const headSha = "a".repeat(40)

test("declares CI reads and approval-gated retries as separate capabilities", () => {
  expect(githubPluginManifest.capabilities).toEqual([
    "repository_read",
    "ci_read",
    "ci_retry",
    "issue_write",
    "pull_request_write",
  ])
})

describe("GitHubActionsWebhookDecoder", () => {
  test("verifies the raw payload and returns only a repository-bound failed workflow signal", () => {
    const decoder = new GitHubActionsWebhookDecoder({ secret: webhookSecret, repository })
    const body = JSON.stringify(webhookPayload())

    const signal = decoder.decode(webhookInput(body))

    expect(signal).toEqual({
      provider: "github",
      event: "workflow_run",
      action: "completed",
      deliveryId: "6dcb09b5-b578-75f3-34f6-1aebed695e2e",
      repository,
      run: { id: 30433642, attempt: 1, headSha },
    })
    expect(JSON.stringify(signal)).not.toContain(webhookSecret)
    expect(JSON.stringify(signal)).not.toContain("ignored untrusted payload field")
  })

  test("fails closed for missing or changed signatures without exposing secrets or payloads", () => {
    const decoder = new GitHubActionsWebhookDecoder({ secret: webhookSecret, repository })
    const body = JSON.stringify(webhookPayload())
    const cases: Array<[unknown, string]> = [
      [{ eventType: "workflow_run", deliveryId: "delivery-1", body }, "webhook_signature_required"],
      [{ ...webhookInput(body), signatureSha256: "" }, "webhook_signature_required"],
      [{ ...webhookInput(body), signatureSha256: `sha256=${"0".repeat(64)}` }, "invalid_webhook_signature"],
      [{ ...webhookInput(body), body: `${body} ` }, "invalid_webhook_signature"],
    ]

    for (const [input, code] of cases) {
      try {
        decoder.decode(input)
        throw new Error("expected webhook validation failure")
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubActionsError)
        expect(error).toMatchObject({ code })
        expect(String(error)).not.toContain(webhookSecret)
        expect(JSON.stringify(error)).not.toContain(headSha)
      }
    }
  })

  test("binds the workflow_run event, failed conclusion, delivery id, and configured repository", () => {
    const decoder = new GitHubActionsWebhookDecoder({ secret: webhookSecret, repository })
    const wrongEventBody = JSON.stringify(webhookPayload())
    expect(() => decoder.decode(webhookInput(wrongEventBody, "check_run"))).toThrow("unsupported_webhook_event")

    const foreignBody = JSON.stringify(webhookPayload({
      repository: { full_name: "attacker/podo", name: "podo", owner: { login: "attacker" } },
    }))
    expect(() => decoder.decode(webhookInput(foreignBody))).toThrow("repository_mismatch")

    const successfulBody = JSON.stringify(webhookPayload({
      workflow_run: { ...workflowPayload(), conclusion: "success" },
    }))
    expect(() => decoder.decode(webhookInput(successfulBody))).toThrow("invalid_webhook_payload")
    expect(() => decoder.decode({ ...webhookInput(wrongEventBody), deliveryId: "bad delivery" }))
      .toThrow("invalid_webhook_input")
  })
})

describe("GitHubActionsReadAdapter", () => {
  test("captures the exact failed run attempt and normalized job/step evidence", async () => {
    const requests: Array<{ url: string; method: string; authorized: boolean }> = []
    const adapter = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input, init) => {
        const url = String(input)
        requests.push({
          url,
          method: init?.method ?? "GET",
          authorized: new Headers(init?.headers).get("authorization") === `Bearer ${token}`,
        })
        if (url.includes("/attempts/1/jobs")) {
          return Response.json({ total_count: 1, jobs: [jobPayload()] })
        }
        return Response.json(runPayload())
      },
    })

    const capture = await adapter.captureFailedRun(signal())

    expect(capture).toEqual({
      schemaVersion: "podo.github-actions.failure.v1",
      deliveryId: signal().deliveryId,
      repository,
      run: {
        id: 30433642,
        workflowId: 159038,
        workflowName: "CI",
        workflowPath: ".github/workflows/ci.yml",
        runNumber: 562,
        attempt: 1,
        event: "pull_request",
        headBranch: "feature/fix",
        headSha,
        status: "completed",
        conclusion: "failure",
        createdAt: "2026-07-16T08:00:00.000Z",
        updatedAt: "2026-07-16T08:05:00.000Z",
        url: "https://github.com/reseaxch/podo/actions/runs/30433642",
      },
      jobs: [{
        id: 399444496,
        runId: 30433642,
        attempt: 1,
        headSha,
        name: "Workspace",
        status: "completed",
        conclusion: "failure",
          startedAt: "2026-07-16T08:00:10.000Z",
          completedAt: "2026-07-16T08:04:50.000Z",
        steps: [{
          number: 7,
          name: "Run workspace checks",
          status: "completed",
          conclusion: "failure",
              startedAt: "2026-07-16T08:01:00.000Z",
              completedAt: "2026-07-16T08:04:40.000Z",
        }],
      }],
    })
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/reseaxch/podo/actions/runs/30433642",
        method: "GET",
        authorized: true,
      },
      {
        url: "https://api.github.com/repos/reseaxch/podo/actions/runs/30433642/attempts/1/jobs?per_page=100&page=1",
        method: "GET",
        authorized: true,
      },
    ])
    expect(JSON.stringify(capture)).not.toContain(token)
  })

  test("reads the current run and lists only runs for the exact head SHA", async () => {
    const urls: string[] = []
    const adapter = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.includes("?")) {
          return Response.json({
            total_count: 2,
            workflow_runs: [
              runPayload({ id: 30433641, run_attempt: 1, created_at: "2026-07-16T07:00:00Z" }),
              runPayload({ id: 30433642, run_attempt: 2, status: "queued", conclusion: null }),
            ],
          })
        }
        return Response.json(runPayload({ run_attempt: 2, status: "in_progress", conclusion: null }))
      },
    })

    const current = await adapter.getCurrentRun({ repository, runId: 30433642, headSha })
    const listed = await adapter.listRunsForHead({ repository, headSha })

    expect(current).toMatchObject({ id: 30433642, attempt: 2, headSha, status: "in_progress", conclusion: null })
    expect(listed).toMatchObject({ repository, headSha })
    expect(listed.runs.map(({ id, attempt }) => ({ id, attempt }))).toEqual([
      { id: 30433641, attempt: 1 },
      { id: 30433642, attempt: 2 },
    ])
    expect(urls[1]).toBe(
      `https://api.github.com/repos/reseaxch/podo/actions/runs?head_sha=${headSha}&per_page=100&page=1`,
    )
  })

  test("rejects mismatched runs, foreign repositories, unsafe origins, and untrusted response data", async () => {
    expect(() => new GitHubActionsReadAdapter({
      token,
      repository,
      apiBaseUrl: "https://github-api.attacker.example",
    })).toThrow("invalid_actions_config")
    expect(() => new GitHubActionsReadAdapter({ token, repository, requestTimeoutMs: 0 }))
      .toThrow("invalid_actions_config")
    expect(() => new GitHubActionsRetryAdapter({ token, repository, requestTimeoutMs: 120_001 }))
      .toThrow("invalid_actions_config")

    let reads = 0
    const adapter = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async () => {
        reads++
        return Response.json(runPayload({ head_sha: "b".repeat(40) }))
      },
    })
    await expect(adapter.getCurrentRun({ repository, runId: 30433642, headSha }))
      .rejects.toMatchObject({ code: "run_binding_mismatch" })
    await expect(adapter.getCurrentRun({
      repository: { owner: "attacker", name: "podo" },
      runId: 30433642,
      headSha,
    })).rejects.toMatchObject({ code: "invalid_read_request" })
    expect(reads).toBe(1)

    const leaked = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async () => Response.json(runPayload({ name: token })),
    })
    try {
      await leaked.getCurrentRun({ repository, runId: 30433642, headSha })
      throw new Error("expected invalid response")
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_github_response" })
      expect(String(error)).not.toContain(token)
      expect(JSON.stringify(error)).not.toContain(token)
    }

    const foreignUrl = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async () => Response.json(runPayload({
        html_url: "https://attacker.example/reseaxch/podo/actions/runs/30433642",
      })),
    })
    await expect(foreignUrl.getCurrentRun({ repository, runId: 30433642, headSha }))
      .rejects.toMatchObject({ code: "invalid_github_response" })
  })

  test("requires completed failure evidence with at least one failed job or step", async () => {
    const successful = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input) => String(input).includes("/jobs")
        ? Response.json({ total_count: 1, jobs: [jobPayload()] })
        : Response.json(runPayload({ conclusion: "success" })),
    })
    await expect(successful.captureFailedRun(signal())).rejects.toMatchObject({
      code: "not_failed_completed_run",
    })

    const noFailedJob = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input) => String(input).includes("/jobs")
        ? Response.json({
          total_count: 1,
          jobs: [jobPayload({
            conclusion: "success",
            steps: [{ ...stepPayload(), conclusion: "success" }],
          })],
        })
        : Response.json(runPayload()),
    })
    await expect(noFailedJob.captureFailedRun(signal())).rejects.toMatchObject({
      code: "invalid_github_response",
    })
  })

  test("rejects run-attempt drift before capture and job bindings from another attempt", async () => {
    let jobReads = 0
    const driftedRun = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input) => {
        if (String(input).includes("/jobs")) jobReads++
        return Response.json(runPayload({ run_attempt: 2 }))
      },
    })
    await expect(driftedRun.captureFailedRun(signal())).rejects.toMatchObject({ code: "run_binding_mismatch" })
    expect(jobReads).toBe(0)

    const driftedJob = new GitHubActionsReadAdapter({
      token,
      repository,
      fetch: async (input) => String(input).includes("/jobs")
        ? Response.json({ total_count: 1, jobs: [jobPayload({ run_attempt: 2 })] })
        : Response.json(runPayload()),
    })
    await expect(driftedJob.captureFailedRun(signal())).rejects.toMatchObject({
      code: "invalid_github_response",
    })
  })

  test("aborts bounded capture and current-run reads with sanitized failures", async () => {
    let aborted = 0
    const createAdapter = () => new GitHubActionsReadAdapter({
      token,
      repository,
      requestTimeoutMs: 5,
      fetch: abortOnlyFetch(() => { aborted++ }),
    })

    await expect(createAdapter().captureFailedRun(signal())).rejects.toMatchObject({ code: "github_read_failed" })
    await expect(createAdapter().getCurrentRun({ repository, runId: 30433642, headSha }))
      .rejects.toMatchObject({ code: "github_read_failed" })
    expect(aborted).toBe(2)
  })
})

describe("GitHubActionsRetryAdapter", () => {
  test("requires Core approval, verifies the exact failed attempt, and retries at most once", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = []
    const adapter = new GitHubActionsRetryAdapter({
      token,
      repository,
      fetch: async (input, init) => {
        const method = init?.method ?? "GET"
        requests.push({
          url: String(input),
          method,
          ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
        })
        return method === "GET" ? Response.json(runPayload()) : new Response(null, { status: 201 })
      },
    })
    const request = retryRequest()

    const [first, concurrent] = await Promise.all([
      adapter.retryFailedJobs(request),
      adapter.retryFailedJobs(request),
    ])
    const repeated = await adapter.retryFailedJobs(request)

    expect(first).toEqual({
      status: "accepted",
      repository,
      incidentId: "build-incident-1",
      idempotencyKey: "retry-command-1",
      run: { id: 30433642, headSha, previousAttempt: 1 },
      authorization: {
        approvalId: "approval-1",
        approvedBy: "operator@example.com",
        approvedAt: "2026-07-16T09:00:00Z",
      },
    })
    expect(concurrent).toEqual(first)
    expect(repeated).toEqual({ ...first, status: "existing" })
    expect(requests).toEqual([
      { url: "https://api.github.com/repos/reseaxch/podo/actions/runs/30433642", method: "GET" },
      {
        url: "https://api.github.com/repos/reseaxch/podo/actions/runs/30433642/rerun-failed-jobs",
        method: "POST",
        body: { enable_debug_logging: false },
      },
    ])
    expect(JSON.stringify(first)).not.toContain(token)
  })

  test("performs no write without approval or when repository, head, or attempt binding fails", async () => {
    let posts = 0
    const adapter = new GitHubActionsRetryAdapter({
      token,
      repository,
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET") === "POST") posts++
        return Response.json(runPayload({ run_attempt: 2 }))
      },
    })
    const request = retryRequest()

    await expect(adapter.retryFailedJobs({ ...request, authorization: undefined }))
      .rejects.toMatchObject({ code: "retry_authorization_required" })
    await expect(adapter.retryFailedJobs({
      ...request,
      authorization: { ...request.authorization, decision: "denied" },
    })).rejects.toMatchObject({ code: "invalid_retry_authorization" })
    await expect(adapter.retryFailedJobs(request)).rejects.toMatchObject({ code: "run_binding_mismatch" })
    await expect(adapter.retryFailedJobs({
      ...request,
      idempotencyKey: "foreign-repository-retry",
      repository: { owner: "attacker", name: "podo" },
    })).rejects.toMatchObject({ code: "invalid_retry_request" })
    expect(posts).toBe(0)
  })

  test("accepts only HTTP 201 and sanitizes downstream read and write failures", async () => {
    const readFailure = new GitHubActionsRetryAdapter({
      token,
      repository,
      fetch: async () => { throw new Error(`read leaked ${token}`) },
    })
    const writeFailure = new GitHubActionsRetryAdapter({
      token,
      repository,
      fetch: async (_input, init) => (init?.method ?? "GET") === "GET"
        ? Response.json(runPayload())
        : new Response(`write leaked ${token}`, { status: 202 }),
    })

    for (const [adapter, code] of [
      [readFailure, "github_read_failed"],
      [writeFailure, "github_write_failed"],
    ] as const) {
      try {
        await adapter.retryFailedJobs(retryRequest())
        throw new Error("expected retry failure")
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubActionsError)
        expect(error).toMatchObject({ code })
        expect(String(error)).not.toContain(token)
        expect(JSON.stringify(error)).not.toContain(token)
      }
    }
  })

  test("aborts a bounded retry write with a sanitized failure", async () => {
    let writes = 0
    let aborted = 0
    const adapter = new GitHubActionsRetryAdapter({
      token,
      repository,
      requestTimeoutMs: 5,
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET") === "GET") return Response.json(runPayload())
        writes++
        return abortOnlyResponse(init?.signal, () => { aborted++ })
      },
    })

    await expect(adapter.retryFailedJobs(retryRequest())).rejects.toMatchObject({ code: "github_write_failed" })
    expect(writes).toBe(1)
    expect(aborted).toBe(1)
  })

  test("rejects reuse of one idempotency key for a different retry identity", async () => {
    const adapter = new GitHubActionsRetryAdapter({
      token,
      repository,
      fetch: async (_input, init) => (init?.method ?? "GET") === "GET"
        ? Response.json(runPayload())
        : new Response(null, { status: 201 }),
    })
    const request = retryRequest()
    await adapter.retryFailedJobs(request)

    await expect(adapter.retryFailedJobs({ ...request, incidentId: "build-incident-2" }))
      .rejects.toMatchObject({ code: "retry_identity_conflict" })
  })
})

function webhookInput(body: string, eventType = "workflow_run") {
  return {
    eventType,
    deliveryId: "6dcb09b5-b578-75f3-34f6-1aebed695e2e",
    signatureSha256: `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`,
    body,
  }
}

function webhookPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "completed",
    repository: { full_name: "reseaxch/podo", name: "podo", owner: { login: "reseaxch" } },
    workflow_run: workflowPayload(),
    untrusted: "ignored untrusted payload field",
    ...overrides,
  }
}

function workflowPayload(): Record<string, unknown> {
  return {
    id: 30433642,
    run_attempt: 1,
    head_sha: headSha,
    status: "completed",
    conclusion: "failure",
  }
}

function signal(): GitHubActionsWebhookSignal {
  return {
    provider: "github",
    event: "workflow_run",
    action: "completed",
    deliveryId: "6dcb09b5-b578-75f3-34f6-1aebed695e2e",
    repository: { ...repository },
    run: { id: 30433642, attempt: 1, headSha },
  }
}

function runPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = typeof overrides.id === "number" ? overrides.id : 30433642
  return {
    id,
    workflow_id: 159038,
    name: "CI",
    path: ".github/workflows/ci.yml",
    run_number: 562,
    run_attempt: 1,
    event: "pull_request",
    head_branch: "feature/fix",
    head_sha: headSha,
    status: "completed",
    conclusion: "failure",
    created_at: "2026-07-16T08:00:00Z",
    updated_at: "2026-07-16T08:05:00Z",
    html_url: `https://github.com/reseaxch/podo/actions/runs/${id}`,
    repository: { full_name: "reseaxch/podo", name: "podo", owner: { login: "reseaxch" } },
    ...overrides,
  }
}

function jobPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 399444496,
    run_id: 30433642,
    run_attempt: 1,
    head_sha: headSha,
    name: "Workspace",
    status: "completed",
    conclusion: "failure",
    started_at: "2026-07-16T08:00:10Z",
    completed_at: "2026-07-16T08:04:50Z",
    steps: [stepPayload()],
    ...overrides,
  }
}

function stepPayload(): Record<string, unknown> {
  return {
    number: 7,
    name: "Run workspace checks",
    status: "completed",
    conclusion: "failure",
    started_at: "2026-07-16T08:01:00Z",
    completed_at: "2026-07-16T08:04:40Z",
  }
}

function retryRequest(): GitHubActionsRetryRequest {
  return {
    authorization: {
      kind: "core.github_actions_retry.v1",
      decision: "approved",
      approvalId: "approval-1",
      approvedBy: "operator@example.com",
      approvedAt: "2026-07-16T09:00:00Z",
    },
    incidentId: "build-incident-1",
    idempotencyKey: "retry-command-1",
    repository: { ...repository },
    run: { id: 30433642, headSha, attempt: 1 },
  }
}

function abortOnlyFetch(onAbort: () => void) {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return abortOnlyResponse(init?.signal, onAbort)
  }
}

function abortOnlyResponse(signal: AbortSignal | null | undefined, onAbort: () => void): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error("missing_abort_signal"))
      return
    }
    const rejectAfterAbort = () => {
      onAbort()
      reject(new Error(`provider stayed open with ${token}`))
    }
    if (signal.aborted) rejectAfterAbort()
    else signal.addEventListener("abort", rejectAfterAbort, { once: true })
  })
}
