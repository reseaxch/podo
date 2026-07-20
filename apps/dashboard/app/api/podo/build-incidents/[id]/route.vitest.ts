import { beforeEach, describe, expect, it, vi } from "vitest"

const createDashboardClient = vi.hoisted(() => vi.fn())
const getBuildIncidentState = vi.hoisted(() => vi.fn())

vi.mock("../../../../lib/dashboard-client", () => ({
  createDashboardClient,
  isDemoDashboard: () => process.env.PODO_DASHBOARD_MODE === "demo",
  isTrustedOperatorMode: () =>
    process.env.PODO_DASHBOARD_MODE === "live" &&
    process.env.PODO_TRUSTED_OPERATOR_MODE === "true",
  trustedMutationRequestError: () => null,
}))
vi.mock("../../../../lib/build-incidents-data", () => ({
  getBuildIncidentState,
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

const context = { params: Promise.resolve({ id: "build-1" }) }

describe("build incident mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PODO_DASHBOARD_MODE
    delete process.env.PODO_TRUSTED_OPERATOR_MODE
  })

  it("rejects demo mutations before creating a Core client", async () => {
    process.env.PODO_DASHBOARD_MODE = "demo"

    const response = await POST(
      request(JSON.stringify({ action: "start-retry" })),
      context,
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
      const response = await POST(request(body), context)

      expect(response.status).toBe(405)
      expect(await response.json()).toMatchObject({
        error: "trusted_operator_mode_required",
      })
      expect(createDashboardClient).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      "retry",
      { action: "start-retry" },
      "startBuildIncidentRetry",
      ["build-1"],
    ],
    [
      "retry approval",
      { action: "decide-retry", approvalId: "retry-1", decision: "approve" },
      "decideBuildIncidentRetry",
      ["build-1", "retry-1", { decision: "approve" }],
    ],
    [
      "remediation",
      { action: "start-remediation" },
      "startIncidentRemediation",
      ["build-1"],
    ],
    [
      "remediation denial",
      {
        action: "decide-remediation",
        approvalId: "remediation-1",
        decision: "deny",
      },
      "denyIncidentRemediation",
      ["build-1", "remediation-1"],
    ],
    [
      "delivery",
      { action: "start-delivery" },
      "startIncidentDelivery",
      ["build-1"],
    ],
    [
      "delivery approval",
      {
        action: "decide-delivery",
        approvalId: "delivery-1",
        decision: "approve",
      },
      "approveIncidentDelivery",
      ["build-1", "delivery-1"],
    ],
    [
      "verification",
      { action: "start-verification" },
      "startBuildRemediationVerification",
      ["build-1"],
    ],
  ] as const)(
    "dispatches %s in explicitly trusted live mode",
    async (_label, command, method, args) => {
      process.env.PODO_DASHBOARD_MODE = "live"
      process.env.PODO_TRUSTED_OPERATOR_MODE = "true"
      const operation = vi.fn()
      const client = { [method]: operation }
      createDashboardClient.mockReturnValue(client)
      getBuildIncidentState.mockResolvedValue({
        incident: { id: "build-1" },
        events: [],
      })

      const response = await POST(request(JSON.stringify(command)), context)

      expect(response.status).toBe(200)
      expect(operation).toHaveBeenCalledWith(...args)
      expect(getBuildIncidentState).toHaveBeenCalledWith("build-1", client)
    },
  )
})
