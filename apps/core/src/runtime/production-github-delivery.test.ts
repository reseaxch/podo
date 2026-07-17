import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import type {
  GitCliBranchPublisherConfig,
  GitHubDeliveryAdapterConfig,
  GitHubDeliveryRequest,
  GitHubDeliveryResult,
} from "@podo/plugin-github"

import type { PullRequestDeliveryInput } from "../modules/remediation/incident-delivery"
import {
  ProductionGitHubDeliveryConfigError,
  createProductionGitHubPullRequestDelivery,
} from "./production-github-delivery"

const token = "github-secret-token-never-expose"
const repositoryRoot = resolve("/repo")
const scratchParent = resolve("/scratch")
const enabledEnvironment = {
  PODO_REMEDIATION_ENABLED: "true",
  PODO_GITHUB_DELIVERY_ENABLED: "true",
  PODO_GITHUB_TOKEN: token,
  PODO_GITHUB_REPOSITORY: "reseaxch/podo",
  PODO_GITHUB_DEFAULT_BRANCH: "main",
  PODO_GITHUB_OPERATOR_IDENTITY: "local-lead",
  PODO_GITHUB_REMOTE_NAME: "origin",
  PODO_GITHUB_COMMAND_TIMEOUT_MS: "120000",
  PODO_GITHUB_MAX_OUTPUT_BYTES: "524288",
  PODO_REMEDIATION_REPOSITORY_ROOT: repositoryRoot,
  PODO_REMEDIATION_SCRATCH_PARENT: scratchParent,
  PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH: "main",
} as const

describe("production GitHub delivery composition", () => {
  test("stays disabled without explicit opt-in and constructs no delivery dependency", () => {
    let dependencyCalls = 0
    const dependencies = {
      createPublisher() { dependencyCalls++; throw new Error("must not run") },
      createAdapter() { dependencyCalls++; throw new Error("must not run") },
    }

    expect(createProductionGitHubPullRequestDelivery({}, dependencies)).toBeUndefined()
    expect(createProductionGitHubPullRequestDelivery({ PODO_GITHUB_DELIVERY_ENABLED: "false" }, dependencies)).toBeUndefined()
    expect(dependencyCalls).toBe(0)
  })

  test("fails closed with a stable sanitized error for incomplete or inconsistent configuration", () => {
    for (const environment of [
      { PODO_GITHUB_DELIVERY_ENABLED: "true", PODO_GITHUB_TOKEN: token },
      { ...enabledEnvironment, PODO_GITHUB_DELIVERY_ENABLED: "yes" },
      { ...enabledEnvironment, PODO_REMEDIATION_ENABLED: "false" },
      { ...enabledEnvironment, PODO_GITHUB_REPOSITORY: "reseaxch/podo/extra" },
      { ...enabledEnvironment, PODO_GITHUB_DEFAULT_BRANCH: "refs/heads/main" },
      { ...enabledEnvironment, PODO_GITHUB_OPERATOR_IDENTITY: " " },
      { ...enabledEnvironment, PODO_GITHUB_OPERATOR_IDENTITY: token },
      { ...enabledEnvironment, PODO_GITHUB_REMOTE_NAME: "--upload-pack=touch" },
      { ...enabledEnvironment, PODO_REMEDIATION_REPOSITORY_ROOT: "repo" },
      { ...enabledEnvironment, PODO_GITHUB_COMMAND_TIMEOUT_MS: "0" },
      { ...enabledEnvironment, PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH: "release" },
    ]) {
      try {
        createProductionGitHubPullRequestDelivery(environment)
        throw new Error("expected invalid config")
      } catch (error) {
        expect(error).toBeInstanceOf(ProductionGitHubDeliveryConfigError)
        expect(String(error)).toBe("ProductionGitHubDeliveryConfigError: invalid_production_github_delivery_config")
        expect(JSON.stringify(error)).not.toContain(token)
      }
    }

    try {
      createProductionGitHubPullRequestDelivery(enabledEnvironment, {
        createPublisher() { throw new Error(`constructor leaked ${token}`) },
      })
      throw new Error("expected constructor failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionGitHubDeliveryConfigError)
      expect(String(error)).not.toContain(token)
    }
  })

  test("binds configured repository and operator while mapping the immutable Core artifact exactly", async () => {
    let publisherConfig: GitCliBranchPublisherConfig | undefined
    let adapterConfig: GitHubDeliveryAdapterConfig | undefined
    let deliveryRequest: GitHubDeliveryRequest | undefined
    let lowLevelPublishes = 0
    const result = githubResult()
    const config = createProductionGitHubPullRequestDelivery(enabledEnvironment, {
      createPublisher(value) {
        publisherConfig = value
        return {
          async publish() {
            lowLevelPublishes += 1
            return { headCommit: "d".repeat(40), resultTreeOid: "c".repeat(40), status: "created" }
          },
        }
      },
      createAdapter(value) {
        adapterConfig = value
        return {
          async deliver(value) {
            deliveryRequest = value
            return result
          },
        }
      },
    })

    expect(config?.expectedRepository).toBe("reseaxch/podo")
    expect(config?.operatorIdentity).toBe("local-lead")
    expect(publisherConfig).toMatchObject({
      repositoryRoot,
      scratchParent,
      remoteName: "origin",
      owner: "reseaxch",
      repository: "podo",
      defaultBranch: "main",
      token,
      commandTimeoutMs: 120_000,
      maxOutputBytes: 524_288,
    })
    expect(adapterConfig).toMatchObject({
      token,
      repository: {
        owner: "reseaxch",
        name: "podo",
        defaultBranch: "main",
        trustedBaseRef: "main",
      },
    })
    const boundPublisher = adapterConfig!.publisher
    expect(typeof boundPublisher.publish).toBe("function")

    await expect(config!.port.deliver(coreInput())).resolves.toEqual({
      provider: "github",
      repository: "reseaxch/podo",
      number: 42,
      url: "https://github.com/reseaxch/podo/pull/42",
      baseCommit: "a".repeat(40),
      baseBranch: "main",
      headBranch: "podo/remediation-a1b2c3d4e5f60708",
      headSha: "d".repeat(40),
      artifactId: "pr_preview_abc",
      proof: {
        providerStatus: "created",
        idempotencyKey: "delivery-1",
        resultTreeOid: "c".repeat(40),
        patchSha256: "b".repeat(64),
        validationChecks: ["core-tests", "typecheck"],
        evidenceIds: ["ev:1", "ev:2"],
        authorization: {
          approvalId: "approval-1",
          approvedBy: "local-lead",
          approvedAt: "2026-07-15T10:00:00.000Z",
        },
      },
    })
    expect(deliveryRequest).toEqual({
      authorization: {
        decision: "approved",
        approvalId: "approval-1",
        approvedBy: "local-lead",
        approvedAt: "2026-07-15T10:00:00.000Z",
      },
      artifact: {
        id: "pr_preview_abc",
        idempotencyKey: "delivery-1",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        content: {
          patch: {
            summary: "Bound cache retention",
            changedFiles: ["src/cache.ts", "test/cache.test.ts"],
            unifiedDiff: "diff --git a/src/cache.ts b/src/cache.ts\n",
            sha256: "b".repeat(64),
          },
          validation: { status: "passed", checks: ["core-tests", "typecheck"] },
          evidenceIds: ["ev:1", "ev:2"],
          baseCommit: "a".repeat(40),
          resultTreeOid: "c".repeat(40),
          title: "fix(checkout): bound cache",
          body: "Evidence-backed verified remediation.",
          baseRef: "main",
          headRef: "podo/remediation-a1b2c3d4e5f60708",
        },
      },
    })
    expect(JSON.stringify(deliveryRequest)).not.toContain(token)
    await expect(boundPublisher.publish({
      repository: { owner: "attacker", name: "other" },
      baseRef: "main",
      headRef: deliveryRequest!.artifact.content.headRef,
      approvedAt: deliveryRequest!.authorization.approvedAt,
      artifact: deliveryRequest!.artifact,
    })).rejects.toMatchObject({ code: "publisher_binding_mismatch" })
    expect(lowLevelPublishes).toBe(0)
  })
})

function coreInput(): PullRequestDeliveryInput {
  return {
    deliveryId: "delivery-1",
    incidentId: "incident-1",
    remediationId: "remediation-1",
    authorization: {
      kind: "core.pull_request_delivery.v1",
      approvalId: "approval-1",
      approvedBy: "local-lead",
      approvedAt: "2026-07-15T10:00:00.000Z",
    },
    artifact: {
      provenance: {
        baseRef: "refs/remotes/origin/main",
        baseCommit: "a".repeat(40),
        resultTreeOid: "c".repeat(40),
      },
      evidenceIds: ["ev:1", "ev:2"],
      patch: {
        summary: "Bound cache retention",
        changedFiles: ["src/cache.ts", "test/cache.test.ts"],
        unifiedDiff: "diff --git a/src/cache.ts b/src/cache.ts\n",
        sha256: "b".repeat(64),
      },
      regression: { test: "incident regression", prePatch: "failed", postPatch: "passed" },
      validation: { status: "passed", checks: ["core-tests", "typecheck"] },
      pullRequestPreview: {
        id: "pr_preview_abc",
        title: "fix(checkout): bound cache",
        body: "Evidence-backed verified remediation.",
        baseBranch: "main",
        headBranch: "podo/remediation-a1b2c3d4e5f60708",
      },
    },
  }
}

function githubResult(): GitHubDeliveryResult {
  return {
    status: "created",
    repository: { owner: "reseaxch", name: "podo" },
    pullRequest: {
      number: 42,
      url: "https://github.com/reseaxch/podo/pull/42",
      state: "open",
      baseRef: "main",
      headRef: "podo/remediation-a1b2c3d4e5f60708",
      headSha: "d".repeat(40),
    },
    artifact: {
      id: "pr_preview_abc",
      idempotencyKey: "delivery-1",
      contentSha256: "e".repeat(64),
      patchSha256: "b".repeat(64),
      baseCommit: "a".repeat(40),
      resultTreeOid: "c".repeat(40),
      validationChecks: ["core-tests", "typecheck"],
      evidenceIds: ["ev:1", "ev:2"],
    },
    authorization: {
      approvalId: "approval-1",
      approvedBy: "local-lead",
      approvedAt: "2026-07-15T10:00:00.000Z",
    },
  }
}
