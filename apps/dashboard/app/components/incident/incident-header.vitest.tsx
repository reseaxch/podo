import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { incidentMock } from "../../mocks/incident"
import { IncidentHeader } from "./incident-header"

describe("IncidentHeader", () => {
  it("exposes useful actions from the more menu", async () => {
    const user = userEvent.setup()
    render(<IncidentHeader incident={incidentMock} onNotify={vi.fn()} />)
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
})
