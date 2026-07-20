import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Topbar } from "./topbar"

const props = {
  owner: { name: "Podo Core", avatar: "/icon.svg" },
  query: "",
  searchLabel: "Search",
  searchPlaceholder: "Search...",
  onQueryChange: vi.fn(),
  onNotify: vi.fn(),
}

describe("Topbar data boundary", () => {
  it("does not expose demo projects or notifications in live mode", () => {
    render(<Topbar {...props} source="core" />)

    expect(screen.getByText("Podo Core")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Notifications" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /podo-cloud/i }),
    ).not.toBeInTheDocument()
  })

  it("keeps fixture project controls in demo mode", () => {
    render(<Topbar {...props} source="demo" />)

    expect(screen.getByRole("button", { name: /podo-cloud/i })).toBeVisible()
    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible()
  })
})
