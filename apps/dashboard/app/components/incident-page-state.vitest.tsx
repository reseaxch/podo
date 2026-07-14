import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { IncidentPageState } from "./incident-page-state"

describe("IncidentPageState", () => {
  it("explains a failed incident request and lets the user retry", () => {
    const retry = vi.fn()
    render(<IncidentPageState kind="error" onRetry={retry} />)
    expect(
      screen.getByRole("heading", { name: "Incident unavailable" }),
    ).toBeInTheDocument()
    screen.getByRole("button", { name: "Try again" }).click()
    expect(retry).toHaveBeenCalledOnce()
  })
})
