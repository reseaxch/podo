import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { IconRail } from "./icon-rail"

vi.mock("next/navigation", () => ({
  usePathname: () => "/system-graph",
}))

describe("IconRail utilities", () => {
  it("uses the Podo brand as the home destination", () => {
    render(<IconRail />)

    expect(screen.getByRole("link", { name: "Podo home" })).toHaveAttribute(
      "href",
      "/overview",
    )
    expect(screen.getByText("Podo")).toBeVisible()
  })

  it("opens the mobile navigation, exposes every primary route, and restores focus", async () => {
    const user = userEvent.setup()
    render(<IconRail />)

    const trigger = screen.getByRole("button", {
      name: "Open primary navigation",
    })
    await user.click(trigger)

    const dialog = screen.getByRole("dialog", { name: "Primary navigation" })
    expect(
      within(dialog).getByRole("link", { name: "Overview" }),
    ).toHaveAttribute("href", "/overview")
    expect(
      within(dialog).getByRole("link", { name: "Safety & approvals" }),
    ).toHaveAttribute("href", "/safety")
    expect(
      within(dialog).getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("href", "/settings")

    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Primary navigation" }),
      ).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveFocus()
  })

  it("opens contextual help and switches to the command line", async () => {
    const user = userEvent.setup()
    render(<IconRail />)

    await user.click(screen.getByRole("button", { name: "Help" }))
    const help = screen.getByRole("dialog", { name: "Podo help" })
    expect(
      within(help).getByRole("link", { name: /Understand the system graph/ }),
    ).toHaveAttribute("href", "/system-graph")

    await user.click(
      within(help).getByRole("button", { name: "Open command line" }),
    )
    expect(
      screen.getByRole("dialog", { name: "Command line" }),
    ).toBeInTheDocument()
  })

  it("filters command destinations and exposes real links", async () => {
    const user = userEvent.setup()
    render(<IconRail />)

    await user.click(screen.getByRole("button", { name: "Open command line" }))
    const dialog = screen.getByRole("dialog", { name: "Command line" })
    await user.type(
      within(dialog).getByRole("searchbox", { name: "Search commands" }),
      "audit",
    )

    expect(
      within(dialog).getByRole("link", { name: /Open audit log/ }),
    ).toHaveAttribute("href", "/audit")
    expect(
      within(dialog).queryByRole("link", { name: /Open settings/ }),
    ).not.toBeInTheDocument()
  })

  it("opens the contextual Podo Agent from the floating trigger", async () => {
    const user = userEvent.setup()
    render(<IconRail />)

    await user.click(screen.getByRole("button", { name: "Open Podo Agent" }))

    const dialog = screen.getByRole("dialog", { name: "Podo Agent" })
    expect(
      screen.queryByRole("button", { name: "Open Podo Agent" }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText("Project context")).toBeInTheDocument()
    expect(within(dialog).getByText("podo-cloud")).toBeInTheDocument()
    expect(within(dialog).getByText("All project evidence")).toBeInTheDocument()
    expect(within(dialog).queryByText("/system-graph")).not.toBeInTheDocument()
    expect(within(dialog).getByText("Read-only")).toBeInTheDocument()
  })
})
