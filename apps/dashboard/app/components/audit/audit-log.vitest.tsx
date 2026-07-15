import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { auditLogMock } from "../../mocks/audit"
import { AuditLog } from "./audit-log"

vi.mock("next/navigation", () => ({
  usePathname: () => "/audit",
}))

describe("AuditLog", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("focuses the stream on exceptions", async () => {
    const user = userEvent.setup()
    render(<AuditLog audit={auditLogMock} />)

    await user.click(screen.getByRole("tab", { name: /Exceptions/ }))

    expect(
      screen.getByRole("row", { name: /Production write blocked/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("row", { name: /Evidence connector degraded/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("row", { name: /Pull request #184 created/ }),
    ).not.toBeInTheDocument()
  })

  it("searches event payload context from the shared topbar", async () => {
    const user = userEvent.setup()
    render(<AuditLog audit={auditLogMock} />)

    await user.type(
      screen.getByRole("searchbox", { name: "Search audit log" }),
      "CheckoutCache.set",
    )

    expect(
      screen.getByRole("row", { name: /Dominant trace span correlated/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("row", { name: /^Inspect evt-/ })).toHaveLength(
      2,
    )
  })

  it("shows the immutable context for a selected event", async () => {
    const user = userEvent.setup()
    render(<AuditLog audit={auditLogMock} />)

    await user.click(
      screen.getByRole("row", { name: /Production write blocked/ }),
    )

    const inspector = screen.getByRole("complementary", {
      name: "Event inspector",
    })
    expect(inspector).toHaveTextContent("policy.capability_denied")
    expect(inspector).toHaveTextContent("Side effects")
    expect(inspector).toHaveTextContent("None")
  })

  it("paginates a long event stream without infinite scrolling", async () => {
    const user = userEvent.setup()
    const events = Array.from({ length: 30 }, (_, index) => ({
      ...auditLogMock.events[0]!,
      id: `evt-page-${index + 1}`,
      title: `Archived event ${index + 1}`,
    }))
    render(<AuditLog audit={{ ...auditLogMock, events }} />)

    expect(
      screen.getByRole("row", { name: /Archived event 25/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("row", { name: /Archived event 26/ }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Next audit page" }))

    expect(
      screen.getByRole("row", { name: /Archived event 26/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("row", { name: /Archived event 1$/ }),
    ).not.toBeInTheDocument()
  })

  it("pauses and resumes the live stream explicitly", async () => {
    const user = userEvent.setup()
    render(<AuditLog audit={auditLogMock} />)

    const live = screen.getByRole("button", { name: "Live" })
    expect(live).toHaveAttribute("aria-pressed", "true")

    await user.click(live)
    expect(screen.getByRole("button", { name: "Paused" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
  })
})
