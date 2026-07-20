import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { SafetyApprovalsController } from "../../lib/safety-types"
import { createMockSafetyController } from "../../mocks/safety-controller"
import { safetyApprovalsMock } from "../../mocks/safety"
import { SafetyApprovals } from "./safety-approvals"

vi.mock("next/navigation", () => ({ usePathname: () => "/safety" }))

function controller(): SafetyApprovalsController {
  return { decide: vi.fn().mockResolvedValue(safetyApprovalsMock) }
}

describe("SafetyApprovals decision boundary", () => {
  it("rejects a decision made against a stale queue revision", async () => {
    const safetyController = createMockSafetyController(safetyApprovalsMock)

    await expect(
      safetyController.decide({
        requestId: "APR-108",
        decision: "approve",
        reason: "Reviewed.",
        expectedStatus: "pending",
        expectedRevision: 6,
      }),
    ).rejects.toThrow(
      "Approval queue changed. Review the latest request before deciding.",
    )
  })

  it("does not mutate when a request is selected or its approval dialog opens", async () => {
    const user = userEvent.setup()
    const safetyController = controller()
    render(
      <SafetyApprovals
        controller={safetyController}
        initial={safetyApprovalsMock}
      />,
    )

    await user.click(
      screen.getByRole("button", {
        name: /^Review APR-109: Run database migration preview\b/,
      }),
    )
    await user.click(screen.getByRole("button", { name: "Review approval" }))

    expect(safetyController.decide).not.toHaveBeenCalled()
    expect(
      screen.getByRole("dialog", { name: "Confirm approval" }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Approve action" }),
    ).toBeDisabled()
  })

  it("contains keyboard focus and restores it when Escape closes the dialog", async () => {
    const user = userEvent.setup()
    render(
      <SafetyApprovals
        controller={controller()}
        initial={safetyApprovalsMock}
      />,
    )

    const trigger = screen.getByRole("button", { name: "Review approval" })
    await user.click(trigger)
    expect(
      screen.getByRole("textbox", { name: "Decision reason" }),
    ).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(
      screen.queryByRole("dialog", { name: "Confirm approval" }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("approves only after a reason and explicit confirmation", async () => {
    const user = userEvent.setup()
    const safetyController = controller()
    render(
      <SafetyApprovals
        controller={safetyController}
        initial={safetyApprovalsMock}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Review approval" }))
    await user.type(
      screen.getByRole("textbox", { name: "Decision reason" }),
      "Patch scope and passing regression tests reviewed.",
    )
    expect(safetyController.decide).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the scope and evidence/,
      }),
    )
    await user.click(screen.getByRole("button", { name: "Approve action" }))

    expect(safetyController.decide).toHaveBeenCalledTimes(1)
    expect(safetyController.decide).toHaveBeenCalledWith({
      requestId: "APR-108",
      decision: "approve",
      reason: "Patch scope and passing regression tests reviewed.",
      expectedStatus: "pending",
      expectedRevision: 7,
    })
  })

  it("keeps denial non-mutating until the final explicit action", async () => {
    const user = userEvent.setup()
    const safetyController = controller()
    render(
      <SafetyApprovals
        controller={safetyController}
        initial={safetyApprovalsMock}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Deny" }))
    await user.type(
      screen.getByRole("textbox", { name: "Decision reason" }),
      "Narrow the repository scope.",
    )
    await user.click(
      screen.getByRole("checkbox", {
        name: /I understand this closes the request/,
      }),
    )

    expect(safetyController.decide).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Deny request" }))
    expect(safetyController.decide).toHaveBeenCalledWith({
      requestId: "APR-108",
      decision: "deny",
      reason: "Narrow the repository scope.",
      expectedStatus: "pending",
      expectedRevision: 7,
    })
  })

  it("fails closed when the controller rejects a decision", async () => {
    const user = userEvent.setup()
    const safetyController = controller()
    vi.mocked(safetyController.decide).mockRejectedValueOnce(
      new Error("Approval request has already been resolved"),
    )
    render(
      <SafetyApprovals
        controller={safetyController}
        initial={safetyApprovalsMock}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Review approval" }))
    await user.type(
      screen.getByRole("textbox", { name: "Decision reason" }),
      "Scope reviewed.",
    )
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the scope and evidence/,
      }),
    )
    await user.click(screen.getByRole("button", { name: "Approve action" }))

    expect(
      await screen.findByText("Approval request has already been resolved"),
    ).toBeVisible()
    expect(
      screen.getByRole("dialog", { name: "Confirm approval" }),
    ).toBeVisible()
    expect(
      screen.getByRole("region", { name: "Approval details for APR-108" }),
    ).toBeVisible()
  })

  it("never offers approval for a policy-blocked request", async () => {
    const user = userEvent.setup()
    const safetyController = controller()
    render(
      <SafetyApprovals
        controller={safetyController}
        initial={safetyApprovalsMock}
      />,
    )

    await user.click(
      screen.getByRole("button", {
        name: /^Review APR-110: Restart production worker pool\b/,
      }),
    )

    expect(screen.getByText("Approval unavailable")).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Review approval" }),
    ).toBeDisabled()
    expect(safetyController.decide).not.toHaveBeenCalled()
  })

  it("searches decision history and policies in their active views", async () => {
    const user = userEvent.setup()
    render(
      <SafetyApprovals
        controller={controller()}
        initial={safetyApprovalsMock}
      />,
    )

    const search = screen.getByRole("searchbox", {
      name: "Search safety and approvals",
    })
    await user.click(screen.getByRole("tab", { name: /Decision history/ }))
    await user.type(search, "Maya Chen")
    expect(screen.getByText("Run unscoped shell command")).toBeVisible()
    expect(
      screen.queryByText("Open rollback analysis issue"),
    ).not.toBeInTheDocument()

    await user.clear(search)
    await user.click(screen.getByRole("tab", { name: /Policies/ }))
    await user.type(search, "default-branch")
    expect(screen.getByText("No direct production mutations")).toBeVisible()
    expect(screen.queryByText("Verified pull requests")).not.toBeInTheDocument()
  })

  it("explains Core metadata that is not available instead of inventing it", async () => {
    const user = userEvent.setup()
    render(
      <SafetyApprovals
        controller={controller()}
        initial={{
          ...safetyApprovalsMock,
          currentActor: "Not provided by Core",
          history: [],
          policies: [],
        }}
        source="core"
      />,
    )

    await user.click(screen.getByRole("tab", { name: /Decision history/ }))
    expect(
      screen.getByText("Decision history is not provided by Core"),
    ).toBeVisible()
    await user.click(screen.getByRole("tab", { name: /Policies/ }))
    expect(
      screen.getByText("Policy metadata is not provided by Core"),
    ).toBeVisible()
  })
})
