import type { BuildIncident } from "@podo/contracts"
import { describe, expect, it } from "vitest"

import { buildRetryRequest } from "./safety-data"

const incident: BuildIncident = {
  id: "build:owner/repo:1042:1",
  status: "retry_pending_approval",
  detector: "github_actions_failure",
  provider: "github_actions",
  repository: "owner/repo",
  affectedService: "dashboard",
  workflow: { id: 81, name: "CI", path: ".github/workflows/ci.yml" },
  sourceRun: {
    id: 1042,
    workflowId: 81,
    workflowName: "CI",
    workflowPath: ".github/workflows/ci.yml",
    runNumber: 52,
    attempt: 1,
    event: "push",
    headBranch: "main",
    headSha: "abcdef1234567890",
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:05:00.000Z",
    url: "https://github.com/owner/repo/actions/runs/1042",
  },
  evidence: [],
  retry: {
    id: "retry-1",
    status: "pending_approval",
    approval: { id: "approval:retry:1", status: "pending" },
    sourceRun: { id: 1042, attempt: 1, headSha: "abcdef1234567890" },
    createdAt: "2026-07-16T10:06:00.000Z",
    updatedAt: "2026-07-16T10:06:00.000Z",
  },
  createdAt: "2026-07-16T10:05:00.000Z",
  updatedAt: "2026-07-16T10:06:00.000Z",
}

describe("buildRetryRequest", () => {
  it("adds pending build retry approvals to the read-only safety queue", () => {
    const request = buildRetryRequest(incident)

    expect(request).toMatchObject({
      incidentId: incident.id,
      title: "Approve exact GitHub Actions retry",
      status: "pending",
      action: "Retry failed jobs for run #52",
      canApprove: false,
      blockedReason: "Trusted operator mode is disabled.",
    })
    expect(request?.id).toContain(encodeURIComponent(incident.id))
    expect(request?.id).toContain(encodeURIComponent("approval:retry:1"))
  })

  it("omits incidents without a pending retry approval", () => {
    const withoutRetry = structuredClone(incident)
    delete withoutRetry.retry
    expect(buildRetryRequest(withoutRetry)).toBeNull()
  })
})
