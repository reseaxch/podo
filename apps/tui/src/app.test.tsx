import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { RootlineTui } from "./app"

describe("RootlineTui", () => {
  test("renders the core endpoint and MVP flow", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(<RootlineTui coreUrl="http://127.0.0.1:4100" />, {
        width: 100,
        height: 12,
      })
    })

    try {
      await act(async () => {
        await setup.renderOnce()
      })
      const frame = setup.captureCharFrame()
      expect(frame).toContain("incident → evidence → root cause → tested fix → pull request")
      expect(frame).toContain("Core: http://127.0.0.1:4100")
    } finally {
      await act(async () => {
        setup.renderer.destroy()
      })
    }
  })
})
