import { beforeEach, describe, expect, it, vi } from "vitest"

const createDashboardClient = vi.hoisted(() => vi.fn())

vi.mock("../../../../lib/dashboard-client", () => ({
  createDashboardClient,
  isDemoDashboard: () => process.env.PODO_DASHBOARD_MODE === "demo",
}))

import { POST } from "./route"

function request(body: string) {
  return new Request(
    "http://dashboard.test/api/podo/build-incidents/build%3Areseaxch%2Fpodo%3A1042%3A1",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    },
  )
}

describe("build incident mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PODO_DASHBOARD_MODE
  })

  it("rejects demo mutations before creating a Core client", async () => {
    process.env.PODO_DASHBOARD_MODE = "demo"

    const response = await POST(
      request(JSON.stringify({ action: "start-retry" })),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET")
    expect(await response.json()).toMatchObject({ error: "demo_read_only" })
    expect(createDashboardClient).not.toHaveBeenCalled()
  })

  it.each([
    ["retry", JSON.stringify({ action: "start-retry" })],
    [
      "retry approval",
      JSON.stringify({
        action: "decide-retry",
        approvalId: "approval-1",
        decision: "approve",
      }),
    ],
    ["remediation", JSON.stringify({ action: "start-remediation" })],
    [
      "remediation approval",
      JSON.stringify({
        action: "decide-remediation",
        approvalId: "approval-2",
        decision: "approve",
      }),
    ],
    ["delivery", JSON.stringify({ action: "start-delivery" })],
    [
      "delivery approval",
      JSON.stringify({
        action: "decide-delivery",
        approvalId: "approval-3",
        decision: "approve",
      }),
    ],
    ["verification", JSON.stringify({ action: "start-verification" })],
    ["invalid command", JSON.stringify({ action: "approve-everything" })],
    ["malformed command", "{"],
    ["oversized command", "x".repeat(20_000)],
  ])(
    "rejects unauthenticated %s without calling Core",
    async (_label, body) => {
      const response = await POST(request(body))

      expect(response.status).toBe(405)
      expect(await response.json()).toMatchObject({
        error: "operator_identity_required",
      })
      expect(createDashboardClient).not.toHaveBeenCalled()
    },
  )
})
