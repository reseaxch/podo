import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { incidentMock } from "../mocks/incident"
import { createMockIncidentController } from "../mocks/incident-controller"
import { IncidentWorkspace } from "./incident-workspace"

describe("IncidentWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("filters evidence from the command search", async () => {
    const user = userEvent.setup()
    render(
      <IncidentWorkspace
        controller={createMockIncidentController(
          incidentMock.id,
          incidentMock.remediation,
          incidentMock.status,
        )}
        incident={incidentMock}
      />,
    )
    await user.type(
      screen.getByRole("searchbox", { name: "Search evidence" }),
      "Datadog",
    )
    expect(
      screen.getByRole("button", {
        name: /^Expand Heap usage increasing\b/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: /^Expand Deploy v2.8.1 to production\b/,
      }),
    ).not.toBeInTheDocument()
  })

  it("syncs the active view when a route changes the initial tab", () => {
    const controller = createMockIncidentController(
      incidentMock.id,
      incidentMock.remediation,
      incidentMock.status,
    )
    const workspace = render(
      <IncidentWorkspace
        controller={controller}
        incident={incidentMock}
        initialTab="evidence"
      />,
    )
    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    workspace.rerender(
      <IncidentWorkspace
        controller={controller}
        incident={incidentMock}
        initialTab="graph"
      />,
    )

    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("persists the selected color theme", async () => {
    const user = userEvent.setup()
    document.documentElement.dataset.theme = "dark"
    render(
      <IncidentWorkspace
        controller={createMockIncidentController(
          incidentMock.id,
          incidentMock.remediation,
          incidentMock.status,
        )}
        incident={incidentMock}
      />,
    )

    await user.click(
      await screen.findByRole("button", { name: "Switch to light theme" }),
    )
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(window.localStorage.getItem("podo-theme-v2")).toBe("light")

    await user.click(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    )
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(window.localStorage.getItem("podo-theme-v2")).toBe("dark")
  })

  it("replays and can stop the causal path", async () => {
    const user = userEvent.setup()
    render(
      <IncidentWorkspace
        controller={createMockIncidentController(
          incidentMock.id,
          incidentMock.remediation,
          incidentMock.status,
        )}
        incident={incidentMock}
      />,
    )

    await user.click(screen.getByRole("tab", { name: "Graph" }))
    await user.click(screen.getByRole("button", { name: "Replay path" }))

    expect(screen.getByRole("button", { name: "Stop replay" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByText(/^Tracing ·/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Stop replay" }))

    expect(screen.getByRole("button", { name: "Replay path" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.queryByText(/^Tracing ·/)).not.toBeInTheDocument()
  })
})
