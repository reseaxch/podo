import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { operationsOverviewMock } from "../../mocks/operations-overview"
import { OperationsOverview } from "./operations-overview"

const pushMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
  useRouter: () => ({ push: pushMock }),
}))

describe("OperationsOverview", () => {
  beforeEach(() => {
    pushMock.mockReset()
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("prioritizes decisions and links each control surface", () => {
    render(<OperationsOverview overview={operationsOverviewMock} />)

    expect(
      screen.getByRole("heading", { name: "What needs you now" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Open Evidence pipeline/ }),
    ).toHaveAttribute("href", "/evidence-sources")
    expect(
      screen.getByRole("link", { name: /Open System graph/ }),
    ).toHaveAttribute("href", "/system-graph")
    expect(
      screen.getByRole("link", { name: /Open Safety boundary/ }),
    ).toHaveAttribute("href", "/safety")
    expect(screen.getByText("Affected services")).toBeInTheDocument()
    expect(screen.getByText("SLO breached")).toBeInTheDocument()
    expect(screen.getByText("Needs approval")).toBeInTheDocument()
    expect(screen.getByText("Escalating")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Pull request #184 created/ }),
    ).toHaveAttribute("href", "/audit?event=evt-018")
  })

  it("keeps resolved incidents out of operational queues", () => {
    render(<OperationsOverview overview={operationsOverviewMock} />)

    expect(
      screen.queryByRole("button", { name: /Open active incident INC-039/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Open decision incident INC-039/ }),
    ).not.toBeInTheDocument()
  })

  it("switches between all active incidents and the current owner's work", async () => {
    const user = userEvent.setup()
    render(<OperationsOverview overview={operationsOverviewMock} />)

    expect(
      screen.getByRole("heading", { name: "5 in view" }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "My work" }))
    expect(
      screen.getByRole("heading", { name: "1 in view" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: /Open active incident INC-042/,
      }),
    ).toBeInTheDocument()
  })

  it("uses the shared command search to narrow active investigations", async () => {
    const user = userEvent.setup()
    render(<OperationsOverview overview={operationsOverviewMock} />)

    await user.type(
      screen.getByRole("searchbox", { name: "Search overview" }),
      "notification",
    )
    expect(
      screen.getByRole("heading", { name: "1 in view" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: /INC-040: Notification delivery backlog\. Workspace unavailable/,
      }),
    ).toBeDisabled()
  })
})
