import { describe, expect, it, vi } from "vitest"

import { runViewTransition } from "./view-transition"

describe("runViewTransition", () => {
  it("updates immediately when the browser API is unavailable", async () => {
    const update = vi.fn()

    await runViewTransition(update)

    expect(update).toHaveBeenCalledOnce()
  })

  it("falls back to the update when starting a transition throws", async () => {
    const update = vi.fn()
    const documentWithTransitions = document as Document & {
      startViewTransition?: () => never
    }

    documentWithTransitions.startViewTransition = vi.fn(() => {
      throw new DOMException("Transition already running", "InvalidStateError")
    })

    await runViewTransition(update)

    expect(update).toHaveBeenCalledOnce()
    Reflect.deleteProperty(documentWithTransitions, "startViewTransition")
  })
})
