import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { incidentMock } from "../mocks/incident"
import { createMockIncidentController } from "../mocks/incident-controller"
import { IncidentWorkspace } from "./incident-workspace"

describe("IncidentWorkspace", () => {
  beforeEach(() => {
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

  it("persists the selected color theme", async () => {
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

    await user.click(
      await screen.findByRole("button", { name: "Switch to dark theme" }),
    )
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(window.localStorage.getItem("podo-theme")).toBe("dark")

    await user.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    )
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
  })
})
