import { describe, expect, test } from "bun:test"

import {
  GitHubIssueDeliveryAdapter,
  GitHubIssueDeliveryError,
  computeIssueArtifactSha256,
  type GitHubIssueDeliveryArtifactContent,
  type GitHubIssueDeliveryRequest,
} from "./issue-delivery"

const token = "github-secret-token"
const content: GitHubIssueDeliveryArtifactContent = {
  incidentId: "incident-1",
  remediationId: "remediation-1",
  title: "[Podo] checkout-service remediation requires manual follow-up",
  body: "## Incident diagnosis\n\nHeap growth is caused by an unbounded cache.\n\n- `evidence-1`",
  evidenceIds: ["evidence-1"],
  remediationFailureCode: "verification_failed",
}

function request(): GitHubIssueDeliveryRequest {
  return {
    authorization: {
      decision: "approved",
      approvalId: "approval-1",
      approvedBy: "operator@example.test",
      approvedAt: "2026-07-15T10:00:00.000Z",
    },
    artifact: {
      id: "issue_draft_1234567890abcdef12345678",
      idempotencyKey: "issue_delivery_1234567890abcdef",
      contentSha256: computeIssueArtifactSha256(content),
      content,
    },
  }
}

function issue(number: number, body: string) {
  return {
    number,
    html_url: `https://github.com/reseaxch/podo/issues/${number}`,
    state: "open",
    title: content.title,
    body,
  }
}

describe("GitHubIssueDeliveryAdapter", () => {
  test("requires authorization, creates once, and reconciles the exact existing issue", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    let stored: ReturnType<typeof issue> | undefined
    const adapter = new GitHubIssueDeliveryAdapter({
      token,
      repository: { owner: "reseaxch", name: "podo" },
      fetch: async (input, init) => {
        const url = String(input)
        const method = init?.method ?? "GET"
        calls.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
        if (method === "GET") return Response.json(stored ? [stored] : [])
        const submitted = JSON.parse(String(init?.body)) as { title: string; body: string }
        stored = issue(9, submitted.body)
        return Response.json(stored, { status: 201 })
      },
    })

    await expect(adapter.deliver({ artifact: request().artifact } as GitHubIssueDeliveryRequest))
      .rejects.toMatchObject({ code: "authorization_required" })
    expect(calls).toHaveLength(0)

    const [created, repeated] = await Promise.all([adapter.deliver(request()), adapter.deliver(request())])
    expect(repeated).toEqual(created)
    expect(created).toMatchObject({
      status: "created",
      repository: { owner: "reseaxch", name: "podo" },
      issue: { number: 9, url: "https://github.com/reseaxch/podo/issues/9", state: "open" },
      artifact: { id: request().artifact.id, idempotencyKey: request().artifact.idempotencyKey },
      authorization: { approvalId: "approval-1", approvedBy: "operator@example.test" },
    })
    expect(calls.filter(({ method }) => method === "POST")).toHaveLength(1)
    expect(JSON.stringify(calls)).not.toContain(token)

    const reconciled = await adapter.deliver(request())
    expect(reconciled).toMatchObject({ status: "existing", issue: { number: 9 } })
    expect(calls.filter(({ method }) => method === "POST")).toHaveLength(1)
  })

  test("fails closed for content hash drift and a conflicting marker", async () => {
    const adapter = new GitHubIssueDeliveryAdapter({
      token,
      repository: { owner: "reseaxch", name: "podo" },
      fetch: async () => Response.json([issue(7, `${content.body}\n\n<!-- podo-issue idempotency-key="issue_delivery_1234567890abcdef" draft-id="different" content-sha256="${"a".repeat(64)}" -->`)]),
    })
    const drifted = request()
    drifted.artifact.content.body = "changed after hashing"
    await expect(adapter.deliver(drifted)).rejects.toMatchObject({ code: "artifact_hash_mismatch" })
    await expect(adapter.deliver(request())).rejects.toBeInstanceOf(GitHubIssueDeliveryError)
    await expect(adapter.deliver(request())).rejects.toMatchObject({ code: "artifact_identity_conflict" })
  })

  test("reconciles an exact issue after an ambiguous create response", async () => {
    let stored: ReturnType<typeof issue> | undefined
    let posts = 0
    const adapter = new GitHubIssueDeliveryAdapter({
      token,
      repository: { owner: "reseaxch", name: "podo" },
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET") === "GET") return Response.json(stored ? [stored] : [])
        posts += 1
        const submitted = JSON.parse(String(init?.body)) as { body: string }
        stored = issue(11, submitted.body)
        throw new Error("response lost after provider accepted write")
      },
    })

    await expect(adapter.deliver(request())).resolves.toMatchObject({
      status: "existing",
      issue: { number: 11, url: "https://github.com/reseaxch/podo/issues/11" },
    })
    expect(posts).toBe(1)
  })
})
