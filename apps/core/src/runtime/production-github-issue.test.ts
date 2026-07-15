import { describe, expect, test } from "bun:test"

import { createProductionGitHubIssueDelivery } from "./production-github-issue"

const environment = {
  PODO_GITHUB_ISSUE_ENABLED: "true",
  PODO_GITHUB_TOKEN: "github-secret-token",
  PODO_GITHUB_REPOSITORY: "reseaxch/podo",
} as const

describe("production GitHub issue composition", () => {
  test("seals core diagnosis and evidence into the real adapter request", async () => {
    const requests: unknown[] = []
    const configs: unknown[] = []
    const delivery = createProductionGitHubIssueDelivery(environment, {
      createAdapter(config) {
        configs.push(config)
        return {
          async create(request) {
            requests.push(request)
            return {
              status: "created" as const,
              repository: { owner: "reseaxch", name: "podo" },
              issue: { number: 92, url: "https://github.com/reseaxch/podo/issues/92", state: "open" as const },
              draft: {
                id: request.draftId,
                idempotencyKey: request.idempotencyKey,
                contentSha256: request.contentSha256,
              },
              authorization: {
                id: request.authorization.authorizationId,
                authorizedAt: request.authorization.authorizedAt,
              },
              incident: {
                id: request.content.incidentId,
                reason: request.content.reason,
                evidenceIds: request.content.evidenceIds,
              },
            }
          },
        }
      },
    })
    if (!delivery) throw new Error("expected issue delivery")

    const result = await delivery.port.create({
      issueDeliveryId: "issue-delivery-1",
      authorization: {
        kind: "core.issue_fallback.v1",
        authorizationId: "authorization-1",
        authorizedAt: "2026-07-15T10:00:00.000Z",
      },
      draft: {
        id: "issue-draft-1",
        idempotencyKey: "issue-delivery-1",
        contentSha256: "a".repeat(64),
        content: {
          incidentId: "incident-1",
          reason: "remediation_failed",
          title: "Incident checkout-service: remediation fallback",
          body: "Evidence-backed diagnosis and proposed remediation. No verified patch is attached.",
          evidenceIds: ["ev:1", "ev:2"],
        },
      },
    })

    expect(configs).toMatchObject([{
      token: environment.PODO_GITHUB_TOKEN,
      repository: { owner: "reseaxch", name: "podo" },
    }])
    expect(requests).toMatchObject([{
      authorization: { kind: "core.issue_fallback.v1", decision: "authorized" },
      draftId: "issue-draft-1",
      idempotencyKey: "issue-delivery-1",
      content: {
        reason: "remediation_failed",
        evidenceIds: ["ev:1", "ev:2"],
      },
    }])
    expect(JSON.stringify(requests)).toContain("No verified patch is attached")
    expect(JSON.stringify(requests)).not.toContain(environment.PODO_GITHUB_TOKEN)
    expect(result).toEqual({
      provider: "github",
      status: "created",
      repository: "reseaxch/podo",
      number: 92,
      url: "https://github.com/reseaxch/podo/issues/92",
      state: "open",
      draft: {
        id: "issue-draft-1",
        idempotencyKey: "issue-delivery-1",
        contentSha256: "a".repeat(64),
      },
      authorization: { id: "authorization-1", authorizedAt: "2026-07-15T10:00:00.000Z" },
      incident: { id: "incident-1", reason: "remediation_failed", evidenceIds: ["ev:1", "ev:2"] },
    })
  })

  test("is disabled by default and rejects incomplete enabled configuration", () => {
    expect(createProductionGitHubIssueDelivery({})).toBeUndefined()
    expect(() => createProductionGitHubIssueDelivery({ PODO_GITHUB_ISSUE_ENABLED: "true" })).toThrow(
      "invalid_production_github_issue_config",
    )
  })
})
