import { beforeEach, describe, expect, it, vi } from "vitest"

const createDashboardClient = vi.hoisted(() => vi.fn())

vi.mock("../../../../lib/dashboard-client", () => ({
  createDashboardClient,
  incidentWorkingDirectory: () => "/tmp/podo-test",
  isTrustedOperatorMode: () => true,
  trustedMutationRequestError: () => null,
}))

import { POST } from "./route"

const context = { params: Promise.resolve({ id: "incident-1" }) }

function request(value: unknown) {
  return new Request("http://dashboard.test/api/podo/incidents/incident-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  })
}

describe("incident mutation validation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects an invalid decision before creating a Core client", async () => {
    const response = await POST(
      request({
        action: "decide-remediation",
        approvalId: "approval-1",
        decision: "approved",
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(createDashboardClient).not.toHaveBeenCalled()
  })

  it("dispatches an exact denial", async () => {
    const client = {
      denyIncidentRemediation: vi.fn().mockResolvedValue({ ok: true }),
    }
    createDashboardClient.mockReturnValue(client)

    const response = await POST(
      request({
        action: "decide-remediation",
        approvalId: "approval-1",
        decision: "deny",
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(client.denyIncidentRemediation).toHaveBeenCalledWith(
      "incident-1",
      "approval-1",
    )
  })
})
