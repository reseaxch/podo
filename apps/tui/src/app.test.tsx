import { afterEach, describe, expect, test } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { PodoTui, type PodoTuiController, type PodoTuiViewModel, type TuiRunStatus } from "./app"

type Setup = Awaited<ReturnType<typeof testRender>>
const activeRenderers: Setup[] = []

const baseViewModel: PodoTuiViewModel = {
  status: "idle",
  statusDetail: "Monitoring is healthy",
  incidentTitle: "checkout cache growth",
  evidence: ["metric: heap rose 84%", "trace: checkout returned 500", "deploy: commit abc123"],
  settings: {
    mode: "recommend",
    monitoringEnabled: true,
    sandbox: "read-only",
    timeoutSeconds: 60,
  },
}

function createController() {
  const calls = {
    approved: [] as string[],
    denied: [] as string[],
    cancelled: 0,
    settings: [] as PodoTuiViewModel["settings"][],
  }
  const controller: PodoTuiController = {
    approve: (id) => calls.approved.push(id),
    deny: (id) => calls.denied.push(id),
    cancel: () => calls.cancelled++,
    saveSettings: (settings) => calls.settings.push(settings),
  }
  return { controller, calls }
}

async function render(viewModel: PodoTuiViewModel, controller?: PodoTuiController, width = 100, height = 24) {
  let setup!: Setup
  await act(async () => {
    setup = await testRender(
      <PodoTui
        coreUrl="http://127.0.0.1:4100"
        viewModel={viewModel}
        {...(controller ? { controller } : {})}
      />,
      { width, height, kittyKeyboard: true },
    )
  })
  await act(async () => {
    await setup.renderOnce()
  })
  activeRenderers.push(setup)
  return setup
}

async function press(setup: Setup, key: string, modifiers?: Parameters<Setup["mockInput"]["pressKey"]>[1]) {
  await act(async () => {
    setup.mockInput.pressKey(key, modifiers)
  })
  await act(async () => {
    await setup.renderOnce()
  })
}

async function emitKey(setup: Setup, key: Partial<KeyEvent> & Pick<KeyEvent, "name">) {
  await act(async () => {
    setup.renderer.keyInput.emit("keypress", {
      eventType: "press",
      repeated: false,
      ctrl: false,
      shift: false,
      meta: false,
      option: false,
      super: false,
      hyper: false,
      ...key,
    } as KeyEvent)
  })
}

afterEach(async () => {
  while (activeRenderers.length > 0) {
    const setup = activeRenderers.pop()!
    await act(async () => setup.renderer.destroy())
  }
})

describe("PodoTui states", () => {
  const expected: Record<TuiRunStatus, string> = {
    loading: "LOADING",
    idle: "READY / IDLE",
    degraded: "DEGRADED",
    running: "RUNNING",
    waiting_for_approval: "WAITING FOR APPROVAL",
    failed: "FAILED",
    completed: "COMPLETED",
    cancelled: "CANCELLED",
  }

  for (const [status, label] of Object.entries(expected) as [TuiRunStatus, string][]) {
    test(`renders ${status}`, async () => {
      const setup = await render({ ...baseViewModel, status })
      expect(setup.captureCharFrame()).toContain(`Status: ${label}`)
    })
  }

  test("renders evidence and settings in a normal layout", async () => {
    const setup = await render(baseViewModel)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Evidence (3)")
    expect(frame).toContain("heap rose 84%")
    expect(frame).toContain("Mode: recommend")
    expect(frame).toContain("Core: http://127.0.0.1:4100")
  })

  test("keeps run and settings visible in a narrow layout", async () => {
    const setup = await render(baseViewModel, undefined, 56, 30)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Status: READY / IDLE")
    expect(frame).toContain("Mode: recommend")
    expect(frame).not.toContain("Core: http://127.0.0.1:4100")
  })
})

describe("PodoTui keyboard contract", () => {
  test("does not approve by default and requires an explicit approval key", async () => {
    const { controller, calls } = createController()
    const setup = await render(
      {
        ...baseViewModel,
        status: "waiting_for_approval",
        pendingApproval: { id: "approval-7", summary: "Allow workspace write?" },
      },
      controller,
    )

    expect(calls.approved).toEqual([])
    expect(setup.captureCharFrame()).toContain("Human approval required")
    await press(setup, "a")
    expect(calls.approved).toEqual(["approval-7"])
  })

  test("does not dispatch approval keys while the settings panel is focused", async () => {
    const { controller, calls } = createController()
    const setup = await render(
      {
        ...baseViewModel,
        status: "waiting_for_approval",
        pendingApproval: { id: "approval-9", summary: "Allow workspace write?" },
      },
      controller,
    )
    await press(setup, "TAB")
    await press(setup, "a")
    expect(calls.approved).toEqual([])
  })

  test("denies and cancels only through explicit keys", async () => {
    const { controller, calls } = createController()
    const viewModel: PodoTuiViewModel = {
      ...baseViewModel,
      status: "waiting_for_approval",
      pendingApproval: { id: "approval-8", summary: "Run tests?" },
    }
    const setup = await render(viewModel, controller)
    await press(setup, "d")
    await press(setup, "c")
    expect(calls.denied).toEqual(["approval-8"])
    expect(calls.cancelled).toBe(1)
  })

  test("ignores repeated and modified destructive keys", async () => {
    const { controller, calls } = createController()
    const setup = await render(
      {
        ...baseViewModel,
        status: "waiting_for_approval",
        pendingApproval: { id: "approval-safe", summary: "Allow workspace write?" },
      },
      controller,
    )

    for (const name of ["a", "d", "c"] as const) {
      await emitKey(setup, { name, repeated: true })
      for (const modifier of ["ctrl", "shift", "meta", "option", "super", "hyper"] as const) {
        await emitKey(setup, { name, [modifier]: true })
      }
    }

    expect(calls.approved).toEqual([])
    expect(calls.denied).toEqual([])
    expect(calls.cancelled).toBe(0)
  })

  test("edits focused settings, saves a complete draft, and exits edit mode", async () => {
    const { controller, calls } = createController()
    const setup = await render(baseViewModel, controller)

    await press(setup, "TAB")
    expect(setup.captureCharFrame()).toContain("> Settings")
    await press(setup, "e")
    expect(setup.captureCharFrame()).toContain("Settings · EDITING")
    await press(setup, "ARROW_RIGHT")
    await press(setup, "TAB")
    await press(setup, " ")
    await press(setup, "s", { ctrl: true })

    expect(calls.settings).toEqual([
      { mode: "act_with_approval", monitoringEnabled: false, sandbox: "read-only", timeoutSeconds: 60 },
    ])
    expect(setup.captureCharFrame()).not.toContain("Settings · EDITING")
  })

  test("escape discards a settings draft without saving", async () => {
    const { controller, calls } = createController()
    const setup = await render(baseViewModel, controller)
    await press(setup, "TAB")
    await press(setup, "e")
    await press(setup, "ARROW_RIGHT")
    await act(async () => {
      setup.mockInput.pressEscape()
    })
    await act(async () => {
      await setup.renderOnce()
    })
    expect(calls.settings).toEqual([])
    expect(setup.captureCharFrame()).toContain("Mode: recommend")
  })

  for (const key of ["q", "ESCAPE"] as const) {
    test(`${key} destroys the renderer outside settings editing`, async () => {
      const setup = await render(baseViewModel)
      await act(async () => {
        setup.mockInput.pressKey(key)
      })
      expect(setup.renderer.isDestroyed).toBe(true)
    })
  }
})
