import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type {
  RemediationController,
  RemediationViewModel,
} from "../../lib/incident-types"
import { ChangesView } from "./changes-view"

const remediation: RemediationViewModel = {
  id: "rem_inc_042",
  reviewState: "ready",
  branch: "fix/inc-042-cache-growth",
  baseBranch: "main",
  pullRequest: null,
}

function controller(): RemediationController {
  return {
    approveAndCreatePullRequest: vi.fn().mockResolvedValue({
      ...remediation,
      reviewState: "approved",
      pullRequest: {
        number: 1842,
        url: "https://github.com/podo/podo/pull/1842",
      },
    }),
    requestChanges: vi.fn().mockResolvedValue({
      ...remediation,
      reviewState: "changes-requested",
    }),
    returnToReview: vi.fn().mockResolvedValue(remediation),
  }
}

describe("ChangesView remediation boundary", () => {
  it("keeps the request-changes draft non-mutating", async () => {
    const user = userEvent.setup()
    const remediationController = controller()

    render(
      <ChangesView
        controller={remediationController}
        incidentId="INC-042"
        onNotify={vi.fn()}
        remediation={remediation}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Request changes" }))

    expect(remediationController.requestChanges).not.toHaveBeenCalled()
    expect(
      screen.getByRole("region", { name: "Request changes" }),
    ).toBeVisible()
  })

  it("calls the injected controller only after approval is explicit", async () => {
    const user = userEvent.setup()
    const remediationController = controller()

    render(
      <ChangesView
        controller={remediationController}
        incidentId="INC-042"
        onNotify={vi.fn()}
        remediation={remediation}
      />,
    )

    expect(
      remediationController.approveAndCreatePullRequest,
    ).not.toHaveBeenCalled()
    const timeline = screen.getByRole("region", {
      name: "Incident to pull request progress",
    })
    expect(within(timeline).getByText("Decision required")).toBeVisible()
    expect(within(timeline).getByText("Created after approval")).toBeVisible()

    await user.click(
      screen.getByRole("button", { name: "Approve & create PR" }),
    )

    expect(
      remediationController.approveAndCreatePullRequest,
    ).toHaveBeenCalledWith({
      incidentId: "INC-042",
      remediationId: "rem_inc_042",
    })
    expect(await screen.findByText("PR #1842 created")).toBeVisible()
    expect(within(timeline).getByText("Approved")).toBeVisible()
    expect(within(timeline).getByText("PR #1842")).toBeVisible()
  })

  it("fails closed when the controller rejects approval", async () => {
    const user = userEvent.setup()
    const remediationController = controller()
    vi.mocked(
      remediationController.approveAndCreatePullRequest,
    ).mockRejectedValueOnce(new Error("Approval denied"))

    render(
      <ChangesView
        controller={remediationController}
        incidentId="INC-042"
        onNotify={vi.fn()}
        remediation={remediation}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "Approve & create PR" }),
    )

    expect(await screen.findByText("Ready for human approval")).toBeVisible()
    expect(screen.queryByText(/PR #1842 created/)).not.toBeInTheDocument()
  })
})
