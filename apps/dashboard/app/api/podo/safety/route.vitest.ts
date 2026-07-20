import { beforeEach, describe, expect, it, vi } from "vitest"

const { getSafetyApprovals, createDashboardClient } = vi.hoisted(() => ({
  getSafetyApprovals: vi.fn(),
  createDashboardClient: vi.fn(),
}))

vi.mock("../../../lib/safety-data", () => ({
  getSafetyApprovals,
  decodeApprovalRequestId: (id: string) => {
    const [kind, incidentId, approvalId] = id.split(":")
    return kind && incidentId && approvalId
      ? {
          kind,
          incidentId: decodeURIComponent(incidentId),
          approvalId: decodeURIComponent(approvalId),
        }
      : null
  },
}))
vi.mock("../../../lib/dashboard-client", () => ({
  createDashboardClient,
  isTrustedOperatorMode: () =>
    process.env.PODO_DASHBOARD_MODE === "live" &&
    process.env.PODO_TRUSTED_OPERATOR_MODE === "true",
  trustedMutationRequestError: () => null,
}))

import { GET, POST } from "./route"

describe("safety API operator boundary", () => {
  beforeEach(() => {
    getSafetyApprovals.mockReset()
    createDashboardClient.mockReset()
    delete process.env.PODO_DASHBOARD_MODE
    delete process.env.PODO_TRUSTED_OPERATOR_MODE
  })

  it("serves the read-only Core approval queue", async () => {
    const view = { requests: [], revision: 0 }
    getSafetyApprovals.mockResolvedValue(view)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(view)
  })

  it("rejects approval mutations until operator identity is authenticated", async () => {
    const response = await POST(
      new Request("http://dashboard.test/api/podo/safety", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "remediation:incident-1:approval-1",
          decision: "approve",
          reason: "Reviewed",
          expectedStatus: "pending",
          expectedRevision: 1,
        }),
      }),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET")
    expect(await response.json()).toEqual({
      error: "trusted_operator_mode_required",
      message:
        "Safety decisions require an explicitly trusted private deployment.",
    })
    expect(getSafetyApprovals).not.toHaveBeenCalled()
  })

  it("dispatches an encoded approval target in trusted live mode", async () => {
    process.env.PODO_DASHBOARD_MODE = "live"
    process.env.PODO_TRUSTED_OPERATOR_MODE = "true"
    const client = { approveIncidentRemediation: vi.fn() }
    createDashboardClient.mockReturnValue(client)
    getSafetyApprovals
      .mockResolvedValueOnce({
        requests: [
          {
            id: "remediation:incident%3A1:approval%2F1",
            status: "pending",
            canApprove: true,
          },
        ],
        revision: 1,
      })
      .mockResolvedValueOnce({ requests: [], revision: 2 })

    const response = await POST(
      new Request("http://dashboard.test/api/podo/safety", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "remediation:incident%3A1:approval%2F1",
          decision: "approve",
          reason: "Reviewed",
          expectedStatus: "pending",
          expectedRevision: 1,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(client.approveIncidentRemediation).toHaveBeenCalledWith(
      "incident:1",
      "approval/1",
    )
  })
})
