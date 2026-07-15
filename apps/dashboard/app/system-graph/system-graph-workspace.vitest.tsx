import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adaptSystemGraph } from "./system-graph-data"
import { SystemGraphWorkspace } from "./system-graph-workspace"

vi.mock("next/navigation", () => ({
  usePathname: () => "/system-graph",
}))

describe("SystemGraphWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("filters the graph by layer and health", async () => {
    const user = userEvent.setup()
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)

    expect(
      screen.getByRole("button", { name: /^Inspect edge-gateway\b/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Delivery" }))

    expect(
      screen.queryByRole("button", { name: /^Inspect edge-gateway\b/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Inspect checkout v1\.8\.4\b/ }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "All layers" }))
    await user.click(screen.getByRole("button", { name: "Issues only" }))
    expect(
      screen.queryByRole("button", { name: /^Inspect inventory-service\b/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Inspect checkout-service\b/ }),
    ).toBeInTheDocument()
  })

  it("searches graph entities and selects a node for inspection", async () => {
    const user = userEvent.setup()
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)

    await user.type(
      screen.getByRole("searchbox", { name: "Search system graph" }),
      "session-cache",
    )
    expect(screen.getByText("1 matches")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: /^Inspect session-cache\.ts\b/ }),
    )
    const inspector = screen.getByRole("complementary", {
      name: "Node details",
    })
    expect(
      within(inspector).getByRole("heading", { name: "session-cache.ts" }),
    ).toBeInTheDocument()
    expect(within(inspector).getByText("Heap retainers")).toBeInTheDocument()
    expect(within(inspector).getByText("63.8 MB")).toBeInTheDocument()

    await user.click(
      within(inspector).getByRole("button", { name: "Close node details" }),
    )
    expect(
      screen.queryByRole("complementary", { name: "Node details" }),
    ).not.toBeInTheDocument()
  })

  it("zooms and restores the graph viewport", async () => {
    const user = userEvent.setup()
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)

    expect(screen.getByText("82%")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(screen.getByText("92%")).toBeInTheDocument()

    const canvas = screen.getByLabelText("Pan and zoom system graph")
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 600 },
    })
    await user.click(screen.getByRole("button", { name: "Fit graph" }))
    expect(screen.getByText("73%")).toBeInTheDocument()
  })

  it("captures wheel zoom without scrolling the page", () => {
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)
    const canvas = screen.getByLabelText("Pan and zoom system graph")
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    })

    fireEvent(canvas, wheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(screen.getByText("92%")).toBeInTheDocument()
  })

  it("finishes a rapid drag without reading cleared pointer state", () => {
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)
    const canvas = screen.getByLabelText("Pan and zoom system graph")
    canvas.setPointerCapture = vi.fn()

    expect(() => {
      fireEvent.pointerDown(canvas, {
        pointerId: 1,
        clientX: 120,
        clientY: 80,
      })
      fireEvent.pointerMove(canvas, {
        pointerId: 1,
        clientX: 170,
        clientY: 105,
      })
      fireEvent.pointerUp(canvas, { pointerId: 1 })
    }).not.toThrow()
  })

  it("opens trace exploration from the selected node", async () => {
    const user = userEvent.setup()
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)

    await user.click(screen.getByRole("button", { name: "Explore traces" }))
    const dialog = screen.getByRole("dialog", {
      name: "Trace explorer for checkout-service",
    })
    expect(dialog).toBeInTheDocument()
    expect(
      within(dialog).getByRole("heading", { name: "POST /checkout" }),
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Close trace explorer" }),
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("links correlated incident context to the incident workspace", () => {
    render(<SystemGraphWorkspace graph={adaptSystemGraph()} />)

    expect(
      screen.getByRole("link", { name: "Open incident INC-042" }),
    ).toHaveAttribute("href", "/#workspace")
  })

  it("renders a safe empty state when no topology is indexed", () => {
    const graph = adaptSystemGraph()
    render(<SystemGraphWorkspace graph={{ ...graph, nodes: [], edges: [] }} />)

    expect(screen.getByText("No topology indexed yet")).toBeInTheDocument()
    expect(
      screen.queryByRole("complementary", { name: "Node details" }),
    ).not.toBeInTheDocument()
  })
})
