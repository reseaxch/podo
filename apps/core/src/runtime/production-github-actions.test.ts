import { describe, expect, test } from "bun:test"
import {
  GitHubActionsError,
  type GitHubActionsFailureSnapshot,
  type GitHubActionsReadAdapterConfig,
  type GitHubActionsRetryAdapterConfig,
  type GitHubActionsRetryRequest,
  type GitHubActionsRetryResult,
  type GitHubActionsRunBinding,
  type GitHubActionsRunsForHead,
  type GitHubActionsRunSnapshot,
  type GitHubActionsWebhookDecoderConfig,
  type GitHubActionsWebhookInput,
  type GitHubActionsWebhookSignal,
  type GitHubActionsWorkflowRunListRequest,
} from "@podo/plugin-github"

import {
  ProductionGitHubActionsConfigError,
  ProductionGitHubActionsOperationError,
  createProductionGitHubActions,
} from "./production-github-actions"

const token = "github-actions-token-never-expose"
const webhookSecret = "github-actions-webhook-secret-never-expose"
const repository = { owner: "reseaxch", name: "podo" } as const
const environment = {
  PODO_GITHUB_ACTIONS_ENABLED: "true",
  PODO_GITHUB_TOKEN: token,
  PODO_GITHUB_REPOSITORY: "reseaxch/podo",
  PODO_GITHUB_ACTIONS_WEBHOOK_SECRET: webhookSecret,
  PODO_GITHUB_ACTIONS_REPOSITORY_CWD: "/srv/podo",
  PODO_GITHUB_OPERATOR_IDENTITY: "local-lead",
} as const

describe("production GitHub Actions composition", () => {
  test("is disabled by default without constructing any dependency", () => {
    let dependencyCalls = 0
    const dependencies = {
      createWebhookDecoder() { dependencyCalls++; throw new Error("must not run") },
      createReadAdapter() { dependencyCalls++; throw new Error("must not run") },
      createRetryAdapter() { dependencyCalls++; throw new Error("must not run") },
    }

    expect(createProductionGitHubActions({}, dependencies)).toBeUndefined()
    expect(createProductionGitHubActions({ PODO_GITHUB_ACTIONS_ENABLED: "false" }, dependencies)).toBeUndefined()
    expect(dependencyCalls).toBe(0)
  })

  test("fails closed with a stable sanitized error for invalid configuration or construction", () => {
    for (const candidate of [
      { PODO_GITHUB_ACTIONS_ENABLED: "true" },
      { ...environment, PODO_GITHUB_ACTIONS_ENABLED: "yes" },
      { ...environment, PODO_GITHUB_REPOSITORY: "reseaxch/podo/extra" },
      { ...environment, PODO_GITHUB_REPOSITORY: "../podo" },
      { ...environment, PODO_GITHUB_ACTIONS_REPOSITORY_CWD: "srv/podo" },
      { ...environment, PODO_GITHUB_ACTIONS_REPOSITORY_CWD: "/srv/podo/" },
      { ...environment, PODO_GITHUB_ACTIONS_REPOSITORY_CWD: "/" },
      { ...environment, PODO_GITHUB_OPERATOR_IDENTITY: "local\nlead" },
      { ...environment, PODO_GITHUB_OPERATOR_IDENTITY: `lead-${token}` },
      { ...environment, PODO_GITHUB_ACTIONS_WEBHOOK_SECRET: token },
    ]) {
      try {
        createProductionGitHubActions(candidate)
        throw new Error("expected invalid config")
      } catch (error) {
        expect(error).toBeInstanceOf(ProductionGitHubActionsConfigError)
        expect(String(error)).toBe("ProductionGitHubActionsConfigError: invalid_production_github_actions_config")
        expect(JSON.stringify(error)).not.toContain(token)
        expect(JSON.stringify(error)).not.toContain(webhookSecret)
      }
    }

    try {
      createProductionGitHubActions(environment, {
        createWebhookDecoder() { throw new Error(`constructor leaked ${token} ${webhookSecret}`) },
      })
      throw new Error("expected constructor failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionGitHubActionsConfigError)
      expect(String(error)).not.toContain(token)
      expect(String(error)).not.toContain(webhookSecret)
    }
  })

  test("binds every adapter to one configured repository and forwards typed Core operations", async () => {
    const decoderConfigs: GitHubActionsWebhookDecoderConfig[] = []
    const readerConfigs: GitHubActionsReadAdapterConfig[] = []
    const retryConfigs: GitHubActionsRetryAdapterConfig[] = []
    const calls: Array<{ operation: string; input: unknown }> = []
    const boundary = createProductionGitHubActions(environment, {
      createWebhookDecoder(config) {
        decoderConfigs.push(config)
        return {
          decode(input) {
            calls.push({ operation: "decode", input })
            return signal
          },
        }
      },
      createReadAdapter(config) {
        readerConfigs.push(config)
        return {
          async captureFailedRun(input) {
            calls.push({ operation: "capture", input })
            return failure
          },
          async getCurrentRun(input) {
            calls.push({ operation: "current", input })
            return currentRun
          },
          async listRunsForHead(input) {
            calls.push({ operation: "list", input })
            return runsForHead
          },
        }
      },
      createRetryAdapter(config) {
        retryConfigs.push(config)
        return {
          async retryFailedJobs(input) {
            calls.push({ operation: "retry", input })
            return retryResult
          },
        }
      },
    })
    if (!boundary) throw new Error("expected enabled GitHub Actions boundary")

    expect(boundary.repository).toEqual(repository)
    expect(boundary.repositoryCwd).toBe("/srv/podo")
    expect(boundary.operatorIdentity).toBe("local-lead")
    expect(decoderConfigs).toEqual([{ secret: webhookSecret, repository }])
    expect(readerConfigs).toEqual([{ token, repository }])
    expect(retryConfigs).toEqual([{ token, repository }])
    expect(JSON.stringify(boundary)).not.toContain(token)
    expect(JSON.stringify(boundary)).not.toContain(webhookSecret)

    expect(boundary.decodeWebhook(webhookInput)).toEqual(signal)
    await expect(boundary.captureFailedRun(signal)).resolves.toEqual(failure)
    await expect(boundary.getCurrentRun(runBinding)).resolves.toEqual(currentRun)
    await expect(boundary.listRunsForHead(listRequest)).resolves.toEqual(runsForHead)
    await expect(boundary.retryFailedJobs(retryRequest)).resolves.toEqual(retryResult)
    expect(calls).toEqual([
      { operation: "decode", input: webhookInput },
      { operation: "capture", input: signal },
      { operation: "current", input: runBinding },
      { operation: "list", input: listRequest },
      { operation: "retry", input: retryRequest },
    ])
    expect(JSON.stringify(calls)).not.toContain(token)
    expect(JSON.stringify(calls)).not.toContain(webhookSecret)
  })

  test("preserves sanitized adapter codes and hides unknown runtime failures", async () => {
    const boundary = createProductionGitHubActions(environment, {
      createWebhookDecoder() {
        return {
          decode() { throw new GitHubActionsError("invalid_webhook_signature") },
        }
      },
      createReadAdapter() {
        return {
          async captureFailedRun() { throw new Error(`read leaked ${token}`) },
          async getCurrentRun() { throw new GitHubActionsError("github_read_failed") },
          async listRunsForHead() { throw new Error(`list leaked ${webhookSecret}`) },
        }
      },
      createRetryAdapter() {
        return {
          async retryFailedJobs() { throw new Error(`write leaked ${token}`) },
        }
      },
    })
    if (!boundary) throw new Error("expected enabled GitHub Actions boundary")

    try {
      boundary.decodeWebhook(webhookInput)
      throw new Error("expected decoder failure")
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubActionsError)
      expect(error).toMatchObject({ code: "invalid_webhook_signature" })
    }

    await expect(boundary.getCurrentRun(runBinding)).rejects.toMatchObject({
      name: "GitHubActionsError",
      code: "github_read_failed",
    })
    for (const operation of [
      boundary.captureFailedRun(signal),
      boundary.listRunsForHead(listRequest),
      boundary.retryFailedJobs(retryRequest),
    ]) {
      try {
        await operation
        throw new Error("expected operation failure")
      } catch (error) {
        expect(error).toBeInstanceOf(ProductionGitHubActionsOperationError)
        expect(String(error)).toBe(
          "ProductionGitHubActionsOperationError: production_github_actions_operation_failed",
        )
        expect(String(error)).not.toContain(token)
        expect(String(error)).not.toContain(webhookSecret)
      }
    }
  })
})

const webhookInput: GitHubActionsWebhookInput = {
  eventType: "workflow_run",
  deliveryId: "delivery-1",
  signatureSha256: `sha256=${"a".repeat(64)}`,
  body: "{}",
}

const signal: GitHubActionsWebhookSignal = {
  provider: "github",
  event: "workflow_run",
  action: "completed",
  deliveryId: "delivery-1",
  repository,
  run: { id: 91_377_001, attempt: 1, headSha: "c".repeat(40) },
}

const currentRun: GitHubActionsRunSnapshot = {
  id: 91_377_001,
  workflowId: 3_001,
  workflowName: "Workspace",
  workflowPath: ".github/workflows/workspace.yml",
  runNumber: 77,
  attempt: 2,
  event: "pull_request",
  headBranch: "codex/uc13-fixture",
  headSha: "c".repeat(40),
  status: "completed",
  conclusion: "success",
  createdAt: "2026-07-15T09:00:00.000Z",
  updatedAt: "2026-07-15T09:10:00.000Z",
  url: "https://github.com/reseaxch/podo/actions/runs/91377001",
}

const failure: GitHubActionsFailureSnapshot = {
  schemaVersion: "podo.github-actions.failure.v1",
  deliveryId: "delivery-1",
  repository,
  run: {
    ...currentRun,
    attempt: 1,
    status: "completed",
    conclusion: "failure",
  },
  jobs: [{
    id: 81_001,
    runId: 91_377_001,
    attempt: 1,
    headSha: "c".repeat(40),
    name: "core tests",
    status: "completed",
    conclusion: "failure",
    startedAt: "2026-07-15T09:00:00.000Z",
    completedAt: "2026-07-15T09:10:00.000Z",
    steps: [{
      number: 1,
      name: "bun test",
      status: "completed",
      conclusion: "failure",
      startedAt: "2026-07-15T09:01:00.000Z",
      completedAt: "2026-07-15T09:09:00.000Z",
    }],
  }],
}

const runBinding: GitHubActionsRunBinding = {
  repository,
  runId: 91_377_001,
  headSha: "c".repeat(40),
}

const listRequest: GitHubActionsWorkflowRunListRequest = {
  repository,
  headSha: "d".repeat(40),
}

const runsForHead: GitHubActionsRunsForHead = {
  repository,
  headSha: "d".repeat(40),
  runs: [{ ...currentRun, id: 91_377_002, headSha: "d".repeat(40), attempt: 1 }],
}

const retryRequest: GitHubActionsRetryRequest = {
  authorization: {
    kind: "core.github_actions_retry.v1",
    decision: "approved",
    approvalId: "approval-1",
    approvedBy: "local-lead",
    approvedAt: "2026-07-15T10:00:00.000Z",
  },
  incidentId: "build-incident-1",
  idempotencyKey: "retry-1",
  repository,
  run: { id: 91_377_001, headSha: "c".repeat(40), attempt: 1 },
}

const retryResult: GitHubActionsRetryResult = {
  status: "accepted",
  incidentId: "build-incident-1",
  idempotencyKey: "retry-1",
  repository,
  run: { id: 91_377_001, headSha: "c".repeat(40), previousAttempt: 1 },
  authorization: {
    approvalId: "approval-1",
    approvedBy: "local-lead",
    approvedAt: "2026-07-15T10:00:00.000Z",
  },
}
