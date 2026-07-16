import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AnimatedNumber } from "./animated-number"

describe("AnimatedNumber", () => {
  it("keeps the final value available to assistive technology", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)

    render(<AnimatedNumber value={42} />)

    expect(screen.getByLabelText("42")).toHaveTextContent("42")
    matchMedia.mockRestore()
  })
})
