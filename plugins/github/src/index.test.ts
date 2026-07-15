import { describe, expect, test } from "bun:test"

import {
  GitHubDeliveryAdapter,
  GitHubDeliveryError,
  GitCliDeliveryBranchPublisher,
  computeDeliveryArtifactSha256,
  computePatchSha256,
  type GitHubBranchPublisher,
  type GitHubDeliveryArtifact,
  type GitHubDeliveryRequest,
  type GitHubFetch,
} from "./index"

import type { PublishVerifiedBranchInput } from "./git-branch-publisher"

const token = "github-secret-token-never-expose"

describe("GitHubDeliveryAdapter", () => {
  test("publishes a verified non-default branch and creates one sanitized pull request", async () => {
    const requests: Array<{ url: string; method: string; authorization: string | null; body?: unknown }> = []
    const publications: unknown[] = []
    const adapter = adapterWith({
      publisher: { async publish(input) { publications.push(input); return publication(input, "a".repeat(40)) } },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization"),
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        })
        if ((init?.method ?? "GET") === "GET") return Response.json([])
        return Response.json({
          number: 42,
          html_url: "https://github.com/reseaxch/podo/pull/42",
          state: "open",
          title: "fix(checkout): bound cache retention",
          base: { ref: "main", sha: "1".repeat(40) },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "a".repeat(40) },
          body: String((JSON.parse(String(init?.body)) as { body: string }).body),
        }, { status: 201 })
      },
    })
    const request = deliveryRequest()

    const result = await adapter.deliver(request)

    expect(result).toEqual({
      status: "created",
      repository: { owner: "reseaxch", name: "podo" },
      pullRequest: {
        number: 42,
        url: "https://github.com/reseaxch/podo/pull/42",
        state: "open",
        baseRef: "main",
        headRef: "podo/remediation-a1b2c3d4e5f60708",
        headSha: "a".repeat(40),
      },
      artifact: {
        id: request.artifact.id,
        idempotencyKey: request.artifact.idempotencyKey,
        contentSha256: request.artifact.contentSha256,
        patchSha256: request.artifact.content.patch.sha256,
        baseCommit: request.artifact.content.baseCommit,
        resultTreeOid: request.artifact.content.resultTreeOid,
        validationChecks: ["core-tests", "typecheck"],
        evidenceIds: ["ev:1", "ev:2"],
      },
      authorization: {
        approvalId: "approval-1",
        approvedBy: "lead@example.com",
        approvedAt: "2026-07-15T10:00:00.000Z",
      },
    })
    expect(publications).toHaveLength(1)
    expect(publications[0]).toMatchObject({
      repository: { owner: "reseaxch", name: "podo" },
      baseRef: "main",
      headRef: "podo/remediation-a1b2c3d4e5f60708",
      artifact: { id: request.artifact.id, contentSha256: request.artifact.contentSha256 },
    })
    expect(requests.map(({ method }) => method)).toEqual(["GET", "POST"])
    expect(requests.every(({ authorization }) => authorization === `Bearer ${token}`)).toBe(true)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.stringify(requests[1]?.body)).toContain(`<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`)
  })

  test("deduplicates concurrent and repeated delivery in one process", async () => {
    let publishes = 0
    let creates = 0
    let createdPull: unknown = null
    const adapter = adapterWith({
      publisher: { async publish(input) { publishes++; return publication(input, "b".repeat(40)) } },
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET") === "GET") return Response.json(createdPull ? [createdPull] : [])
        creates++
        createdPull = {
          number: 7,
          html_url: "https://github.com/reseaxch/podo/pull/7",
          state: "open",
          title: "fix(checkout): bound cache retention",
          base: { ref: "main", sha: "1".repeat(40) },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "b".repeat(40) },
          body: String((JSON.parse(String(init?.body)) as { body: string }).body),
        }
        return Response.json(createdPull, { status: 201 })
      },
    })
    const request = deliveryRequest()

    const [first, second] = await Promise.all([adapter.deliver(request), adapter.deliver(request)])
    const repeated = await adapter.deliver(request)

    expect(second).toEqual(first)
    expect(repeated).toMatchObject({ status: "existing", pullRequest: first.pullRequest })
    expect(publishes).toBe(2)
    expect(creates).toBe(1)
  })

  test("reconstructs the tested head before accepting an existing idempotency marker", async () => {
    const request = deliveryRequest()
    const marker = `<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`
    let publishes = 0
    let posts = 0
    const adapter = adapterWith({
      publisher: { async publish(input) { publishes++; return publication(input, "d".repeat(40)) } },
      fetch: async (_input, init) => {
        if (init?.method === "POST") posts++
        return Response.json([{
          number: 9,
          html_url: "https://github.com/reseaxch/podo/pull/9",
          state: "closed",
          title: request.artifact.content.title,
          base: { ref: "main", sha: request.artifact.content.baseCommit },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "d".repeat(40) },
          body: `${request.artifact.content.body}\n\n${marker}`,
        }])
      },
    })

    const result = await adapter.deliver(request)

    expect(result.status).toBe("existing")
    expect(result.pullRequest).toMatchObject({ number: 9, state: "closed", headSha: "d".repeat(40) })
    expect(publishes).toBe(1)
    expect(posts).toBe(0)
  })

  test("fails closed before network or publication for authorization, validation, branch, and hash gates", async () => {
    let calls = 0
    const adapter = adapterWith({
      publisher: { async publish(input) { calls++; return publication(input, "e".repeat(40)) } },
      fetch: async () => { calls++; return Response.json([]) },
    })
    const valid = deliveryRequest()
    const cases: Array<{ request: GitHubDeliveryRequest; code: string }> = [
      { request: { ...valid, authorization: undefined as never }, code: "authorization_required" },
      {
        request: withArtifact(valid, { validation: { status: "failed", checks: ["core-tests"] } }),
        code: "validation_failed",
      },
      { request: withArtifact(valid, { headRef: "main" }), code: "unsafe_head_branch" },
      { request: withArtifact(valid, { headRef: "feature/not-derived" }), code: "unsafe_head_branch" },
      { request: withArtifact(valid, { baseRef: "release" }), code: "untrusted_base_branch" },
      { request: { ...valid, artifact: { ...valid.artifact, contentSha256: "f".repeat(64) } }, code: "artifact_hash_mismatch" },
      { request: withArtifact(valid, { patch: { ...valid.artifact.content.patch, sha256: "0".repeat(64) } }), code: "patch_hash_mismatch" },
    ]

    for (const item of cases) {
      await expect(adapter.deliver(item.request)).rejects.toMatchObject({ code: item.code })
    }
    expect(calls).toBe(0)
  })

  test("never copies token or untrusted downstream errors into failures", async () => {
    const readFailure = adapterWith({
      publisher: noOpPublisher(),
      fetch: async () => { throw new Error(`fetch leaked ${token}`) },
    })
    const publisherFailure = adapterWith({
      publisher: { async publish() { throw new Error(`publisher leaked ${token}`) } },
      fetch: async () => Response.json([]),
    })

    for (const [adapter, code] of [[readFailure, "github_read_failed"], [publisherFailure, "branch_publish_failed"]] as const) {
      try {
        await adapter.deliver(deliveryRequest())
        throw new Error("expected delivery failure")
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubDeliveryError)
        expect(error).toMatchObject({ code })
        expect(String(error)).not.toContain(token)
        expect(JSON.stringify(error)).not.toContain(token)
      }
    }
  })

  test("reconciles a create race after GitHub returns 422 without a second create", async () => {
    const request = deliveryRequest()
    const marker = `<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`
    let reads = 0
    let creates = 0
    const adapter = adapterWith({
      publisher: noOpPublisher(),
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET") === "POST") {
          creates++
          return Response.json({}, { status: 422 })
        }
        reads++
        return reads === 1 ? Response.json([]) : Response.json([{
          number: 44,
          html_url: "https://github.com/reseaxch/podo/pull/44",
          state: "open",
          title: request.artifact.content.title,
          base: { ref: "main", sha: request.artifact.content.baseCommit },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "a".repeat(40) },
          body: `${request.artifact.content.body}\n\n${marker}`,
        }])
      },
    })

    await expect(adapter.deliver(request)).resolves.toMatchObject({
      status: "existing",
      pullRequest: { number: 44, headSha: "a".repeat(40) },
    })
    expect(creates).toBe(1)
  })

  test("rejects a foreign PR URL and publisher results not bound to the tested artifact", async () => {
    const foreignUrl = adapterWith({
      publisher: noOpPublisher(),
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET") === "GET") return Response.json([])
        const request = deliveryRequest()
        return Response.json({
          number: 42,
          html_url: "https://evil.example/reseaxch/podo/pull/42",
          state: "open",
          title: request.artifact.content.title,
          base: { ref: "main", sha: request.artifact.content.baseCommit },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "a".repeat(40) },
          body: `${request.artifact.content.body}\n\n<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`,
        }, { status: 201 })
      },
    })
    const mismatchedPublisher = adapterWith({
      publisher: {
        async publish(input) {
          return { ...publication(input, "a".repeat(40)), contentSha256: "f".repeat(64) }
        },
      },
      fetch: async () => { throw new Error("must not search") },
    })
    const mismatchedTree = adapterWith({
      publisher: {
        async publish(input) {
          return { ...publication(input, "a".repeat(40)), resultTreeOid: "f".repeat(40) }
        },
      },
      fetch: async () => { throw new Error("must not search") },
    })
    const mutatedExistingHead = adapterWith({
      publisher: noOpPublisher(),
      fetch: async () => {
        const request = deliveryRequest()
        return Response.json([{
          number: 43,
          html_url: "https://github.com/reseaxch/podo/pull/43",
          state: "open",
          title: request.artifact.content.title,
          base: { ref: "main", sha: request.artifact.content.baseCommit },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "b".repeat(40) },
          body: `${request.artifact.content.body}\n\n<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`,
        }])
      },
    })

    await expect(foreignUrl.deliver(deliveryRequest())).rejects.toMatchObject({ code: "invalid_github_response" })
    await expect(mismatchedPublisher.deliver(deliveryRequest())).rejects.toMatchObject({ code: "invalid_publisher_result" })
    await expect(mismatchedTree.deliver(deliveryRequest())).rejects.toMatchObject({ code: "invalid_publisher_result" })
    await expect(mutatedExistingHead.deliver(deliveryRequest())).rejects.toMatchObject({ code: "artifact_identity_conflict" })
  })

  test("rejects an existing marked pull request whose title or body was edited", async () => {
    const request = deliveryRequest()
    const marker = `<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`
    for (const mutation of [
      { title: "fix(checkout): unrelated change", body: `${request.artifact.content.body}\n\n${marker}` },
      { title: request.artifact.content.title, body: `Edited body\n\n${marker}` },
    ]) {
      const adapter = adapterWith({
        publisher: noOpPublisher(),
        fetch: async () => Response.json([{
          number: 45,
          html_url: "https://github.com/reseaxch/podo/pull/45",
          state: "open",
          ...mutation,
          base: { ref: "main", sha: request.artifact.content.baseCommit },
          head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "a".repeat(40) },
        }]),
      })
      await expect(adapter.deliver(request)).rejects.toMatchObject({ code: "artifact_identity_conflict" })
    }
  })

  test("rejects an existing marked pull request whose reported base commit drifted", async () => {
    const request = deliveryRequest()
    const marker = `<!-- podo-delivery:${request.artifact.idempotencyKey}:${request.artifact.id}:${request.artifact.contentSha256} -->`
    const adapter = adapterWith({
      publisher: noOpPublisher(),
      fetch: async () => Response.json([{
        number: 46,
        html_url: "https://github.com/reseaxch/podo/pull/46",
        state: "open",
        title: request.artifact.content.title,
        body: `${request.artifact.content.body}\n\n${marker}`,
        base: { ref: "main", sha: "f".repeat(40) },
        head: { ref: "podo/remediation-a1b2c3d4e5f60708", sha: "a".repeat(40) },
      }]),
    })

    await expect(adapter.deliver(request)).rejects.toMatchObject({ code: "artifact_identity_conflict" })
  })

  test("rejects credentials and authorization strings with surrounding whitespace", async () => {
    expect(() => new GitHubDeliveryAdapter({
      token: ` ${token}`,
      repository: { owner: "reseaxch", name: "podo", defaultBranch: "main", trustedBaseRef: "main" },
      publisher: noOpPublisher(),
      fetch: async () => Response.json([]),
    })).toThrow("invalid_delivery_config")
    const request = deliveryRequest()
    const adapter = adapterWith({ publisher: noOpPublisher(), fetch: async () => Response.json([]) })
    await expect(adapter.deliver({
      ...request,
      authorization: { ...request.authorization, approvedBy: " lead@example.com" },
    })).rejects.toMatchObject({ code: "invalid_authorization" })
    await expect(adapter.deliver({
      ...request,
      authorization: { ...request.authorization, approvedBy: token },
    })).rejects.toMatchObject({ code: "invalid_artifact" })
  })

  test("pins GitHub REST to the official API origin and rejects the token anywhere in the sealed input", async () => {
    expect(() => new GitHubDeliveryAdapter({
      token,
      repository: { owner: "reseaxch", name: "podo", defaultBranch: "main", trustedBaseRef: "main" },
      publisher: noOpPublisher(),
      fetch: async () => Response.json([]),
      apiBaseUrl: "https://attacker.example",
    })).toThrow("invalid_delivery_config")

    const adapter = adapterWith({ publisher: noOpPublisher(), fetch: async () => Response.json([]) })
    const request = deliveryRequest()
    const unifiedDiff = `diff --git a/src/cache.ts b/src/cache.ts\n-${token}\n+bounded\n`
    await expect(adapter.deliver(withArtifact(request, {
      patch: {
        ...request.artifact.content.patch,
        unifiedDiff,
        sha256: computePatchSha256(unifiedDiff),
      },
    }))).rejects.toMatchObject({ code: "invalid_artifact" })
  })

  test("bridges the sealed delivery artifact to GitCliBranchPublisher without weakening bindings", async () => {
    const calls: PublishVerifiedBranchInput[] = []
    const bridge = new GitCliDeliveryBranchPublisher(
      {
        async publish(input) {
          calls.push(input)
          return {
            headCommit: "a".repeat(40),
            resultTreeOid: input.resultTreeOid,
            status: "created" as const,
          }
        },
      },
      { repository: { owner: "reseaxch", name: "podo" }, baseRef: "main" },
    )
    const request = deliveryRequest()

    const result = await bridge.publish({
      repository: { owner: "reseaxch", name: "podo" },
      baseRef: request.artifact.content.baseRef,
      headRef: request.artifact.content.headRef,
      approvedAt: request.authorization.approvedAt,
      artifact: request.artifact,
    })

    expect(calls).toEqual([{
      baseCommit: request.artifact.content.baseCommit,
      unifiedDiff: request.artifact.content.patch.unifiedDiff,
      patchSha256: request.artifact.content.patch.sha256,
      changedFiles: request.artifact.content.patch.changedFiles,
      resultTreeOid: request.artifact.content.resultTreeOid,
      headBranch: request.artifact.content.headRef,
      commitMessage: request.artifact.content.title,
      commitTimestamp: request.authorization.approvedAt,
    }])
    expect(result).toEqual({
      headSha: "a".repeat(40),
      resultTreeOid: request.artifact.content.resultTreeOid,
      artifactId: request.artifact.id,
      contentSha256: request.artifact.contentSha256,
      baseCommit: request.artifact.content.baseCommit,
    })

    await expect(bridge.publish({
      repository: { owner: "attacker", name: "podo" },
      baseRef: request.artifact.content.baseRef,
      headRef: request.artifact.content.headRef,
      approvedAt: request.authorization.approvedAt,
      artifact: request.artifact,
    })).rejects.toMatchObject({ code: "publisher_binding_mismatch" })
    expect(calls).toHaveLength(1)
  })
})

function adapterWith(input: { fetch: GitHubFetch; publisher: GitHubBranchPublisher }) {
  return new GitHubDeliveryAdapter({
    token,
    repository: {
      owner: "reseaxch",
      name: "podo",
      defaultBranch: "main",
      trustedBaseRef: "main",
    },
    fetch: input.fetch,
    publisher: input.publisher,
  })
}

function noOpPublisher(): GitHubBranchPublisher {
  return { async publish(input) { return publication(input, "a".repeat(40)) } }
}

function publication(input: Parameters<GitHubBranchPublisher["publish"]>[0], headSha: string) {
  return {
    headSha,
    resultTreeOid: input.artifact.content.resultTreeOid,
    artifactId: input.artifact.id,
    contentSha256: input.artifact.contentSha256,
    baseCommit: input.artifact.content.baseCommit,
  }
}

function deliveryRequest(): GitHubDeliveryRequest {
  const content: GitHubDeliveryArtifact["content"] = {
    patch: {
      summary: "Bound checkout cache retention",
      changedFiles: ["src/cache.ts", "test/cache.test.ts"],
      unifiedDiff: "diff --git a/src/cache.ts b/src/cache.ts\n-old\n+bounded\n",
      sha256: computePatchSha256("diff --git a/src/cache.ts b/src/cache.ts\n-old\n+bounded\n"),
    },
    validation: { status: "passed", checks: ["core-tests", "typecheck"] },
    evidenceIds: ["ev:1", "ev:2"],
    baseCommit: "1".repeat(40),
    resultTreeOid: "2".repeat(40),
    title: "fix(checkout): bound cache retention",
    body: "Adds a bounded cache and regression coverage.",
    baseRef: "main",
    headRef: "podo/remediation-a1b2c3d4e5f60708",
  }
  return {
    authorization: {
      decision: "approved",
      approvalId: "approval-1",
      approvedBy: "lead@example.com",
      approvedAt: "2026-07-15T10:00:00.000Z",
    },
    artifact: {
      id: "artifact_0123456789abcdef",
      idempotencyKey: "remediation_0123456789abcdef",
      content,
      contentSha256: computeDeliveryArtifactSha256(content),
    },
  }
}

function withArtifact(
  request: GitHubDeliveryRequest,
  patch: Partial<GitHubDeliveryArtifact["content"]>,
): GitHubDeliveryRequest {
  const content = { ...request.artifact.content, ...patch }
  return {
    ...request,
    artifact: { ...request.artifact, content, contentSha256: computeDeliveryArtifactSha256(content) },
  }
}
