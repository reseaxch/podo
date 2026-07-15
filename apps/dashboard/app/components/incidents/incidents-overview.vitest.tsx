import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { incidentOverviewMock } from "../../mocks/incidents"
import { IncidentsOverview } from "./incidents-overview"

describe("IncidentsOverview", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("filters the operational inbox by status and service", async () => {
    const user = userEvent.setup()
    render(<IncidentsOverview overview={incidentOverviewMock} />)

    expect(
      screen.getByRole("button", {
        name: /Open INC-042: Checkout memory growth after deploy/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: /Open INC-039: Elevated checkout 500 rate/,
      }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: /^Resolved/ }))
    expect(
      screen.getByRole("button", {
        name: /Open INC-039: Elevated checkout 500 rate/,
      }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole("combobox", {
        name: "Filter by service: All services",
      }),
    )
    await user.click(screen.getByRole("option", { name: "identity-edge" }))
    expect(
      screen.getByRole("button", {
        name: /Open INC-038: Identity token verification failures/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: /Open INC-039: Elevated checkout 500 rate/,
      }),
    ).not.toBeInTheDocument()
  })

  it("searches incident titles and diagnoses", async () => {
    const user = userEvent.setup()
    render(<IncidentsOverview overview={incidentOverviewMock} />)

    await user.click(screen.getByRole("tab", { name: /^All/ }))
    await user.type(
      screen.getByRole("searchbox", { name: "Search incidents" }),
      "signing-key",
    )

    expect(
      screen.getByRole("button", {
        name: /Open INC-038: Identity token verification failures/,
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /^Open INC-/ })).toHaveLength(
      1,
    )
  })

  it("paginates the filtered incident collection", async () => {
    const user = userEvent.setup()
    render(<IncidentsOverview overview={incidentOverviewMock} />)

    await user.click(screen.getByRole("tab", { name: /^All/ }))
    expect(
      screen.queryByRole("button", {
        name: /Open INC-035: Order export jobs timing out/,
      }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(
      screen.getByRole("button", {
        name: /Open INC-035: Order export jobs timing out/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  it("links back to the operational overview", () => {
    render(<IncidentsOverview overview={incidentOverviewMock} />)

    expect(
      screen.getAllByRole("link", { name: "Overview" }).at(-1),
    ).toHaveAttribute("href", "/overview")
  })
})
