import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { IconRail } from "./icon-rail"

vi.mock("next/navigation", () => ({
  usePathname: () => "/system-graph",
}))

describe("IconRail utilities", () => {
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
})
