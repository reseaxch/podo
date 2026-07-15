import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { incidentMock } from "../../mocks/incident"
import { createMockIncidentController } from "../../mocks/incident-controller"
import { IncidentHeader } from "./incident-header"

describe("IncidentHeader", () => {
  it("exposes useful actions from the more menu", async () => {
    const user = userEvent.setup()
    render(
      <IncidentHeader
        controller={createMockIncidentController(
          incidentMock.id,
          incidentMock.remediation,
          incidentMock.status,
        )}
        incident={incidentMock}
        onNotify={vi.fn()}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "More incident actions" }),
    )
    expect(
      screen.getByRole("menuitem", { name: /Copy incident ID/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: /Mute updates/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: /Export summary/ }),
    ).toBeInTheDocument()
  })

  it("keeps status unchanged when the controller rejects", async () => {
    const user = userEvent.setup()
    const controller = createMockIncidentController(
      incidentMock.id,
      incidentMock.remediation,
      incidentMock.status,
    )
    controller.updateStatus = vi
      .fn()
      .mockRejectedValue(new Error("Status service unavailable"))
    const onNotify = vi.fn()
    render(
      <IncidentHeader
        controller={controller}
        incident={incidentMock}
        onNotify={onNotify}
      />,
    )

    await user.click(screen.getByRole("button", { name: /Investigating/ }))
    await user.click(screen.getByRole("menuitem", { name: /Resolved/ }))

    expect(controller.updateStatus).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("button", { name: /Investigating/ }),
    ).toBeInTheDocument()
    expect(onNotify).toHaveBeenLastCalledWith("Status service unavailable")
  })
})
