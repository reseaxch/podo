import { afterEach, describe, expect, test } from "bun:test"
import type { PodoClient } from "@podo/client"
import type {
  DetectedIncident,
  Investigation,
  InvestigationEvent,
} from "@podo/contracts"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"

import { ConnectedPodoTui } from "./connected"

type Setup = Awaited<ReturnType<typeof testRender>>

const activeRenderers: Setup[] = []

const settings = {
  autonomyMode: "recommend" as const,
  monitoringEnabled: true,
  defaultSandbox: "read-only" as const,
  turnTimeoutMs: 60_000,
}

const readySystem = {
  service: "podo-core" as const,
  status: "ready" as const,
  version: "0.0.0",
  codex: { available: true, binary: "codex", transport: "stdio" as const, version: "0.144.1" },
  remediation: { configured: false },
}

function investigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    id: "investigation-1",
    status: "running",
    cwd: "/workspace/podo",
    sandbox: "read-only",
    createdAt: "2026-07-17T09:00:00.000Z",
    updatedAt: "2026-07-17T09:00:00.000Z",
    lastSequence: 0,
    pendingApproval: null,
    ...overrides,
  }
}

function incident(
  overrides: Omit<Partial<DetectedIncident>, "investigation"> & { investigation?: Investigation } = {},
): DetectedIncident {
  const { investigation: currentInvestigation, ...incidentOverrides } = overrides
  return {
    id: "incident-1",
    status: "detected",
    detector: "cache_growth",
    affectedService: "checkout-service",
    deploymentId: "deploy-1042",
    createdAt: "2026-07-17T09:00:00.000Z",
    updatedAt: "2026-07-17T09:00:00.000Z",
    evidence: [{
      id: "evidence-1",
      sourceEventId: "telemetry-1",
      sourceType: "metric",
      observedAt: "2026-07-17T09:00:00.000Z",
      service: "checkout-service",
      deploymentId: "deploy-1042",
    }],
    ...incidentOverrides,
    ...(currentInvestigation ? {
      investigation: {
        id: currentInvestigation.id,
        status: currentInvestigation.status,
        startedAt: currentInvestigation.createdAt,
        updatedAt: currentInvestigation.updatedAt,
      },
    } : {}),
  }
}

function client(overrides: Partial<PodoClient> = {}): PodoClient {
  return {
    health: async () => ({ service: "podo-core", status: "ok", version: "0.0.0" }),
    systemStatus: async () => readySystem,
    getSettings: async () => ({ settings }),
    updateSettings: async (patch) => ({ settings: { ...settings, ...patch } }),
    ingestTelemetry: async () => { throw new Error("unused") },
    listIncidents: async () => ({ incidents: [] }),
    getIncident: async () => { throw new Error("unused") },
    start: async () => { throw new Error("unused") },
    get: async () => { throw new Error("unused") },
    cancel: async () => { throw new Error("unused") },
    startInvestigation: async () => { throw new Error("unused") },
    getInvestigation: async () => { throw new Error("unused") },
    cancelInvestigation: async () => { throw new Error("unused") },
    approve: async () => { throw new Error("unused") },
    deny: async () => { throw new Error("unused") },
    subscribeEvents: () => { throw new Error("unused") },
    ...overrides,
  }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    signal?.addEventListener("abort", () => resolve(), { once: true })
  })
}

async function* waitForCancellation(signal: AbortSignal | undefined): AsyncGenerator<InvestigationEvent> {
  await waitForAbort(signal)
}

async function renderConnected(fakeClient: PodoClient) {
  let setup!: Setup
  await act(async () => {
    setup = await testRender(
      <ConnectedPodoTui
        coreUrl="http://podo.test"
        client={fakeClient}
        reconnectDelayMs={0}
      />,
      { width: 100, height: 28, kittyKeyboard: true },
    )
  })
  activeRenderers.push(setup)
  return setup
}

async function waitForFrame(setup: Setup, predicate: (frame: string) => boolean): Promise<string> {
  let frame = ""
  await act(async () => {
    frame = await setup.waitForFrame(predicate)
  })
  return frame
}

afterEach(async () => {
  while (activeRenderers.length > 0) {
    const setup = activeRenderers.pop()!
    await act(async () => setup.renderer.destroy())
  }
})

describe("ConnectedPodoTui incident investigation adapter", () => {
  test("uses only a linked incident investigation, resumes after its cursor, and never renders raw deltas", async () => {
    const calls: Array<[string, number | undefined]> = []
    const currentInvestigation = investigation({ lastSequence: 3 })
    const current = incident({
      investigation: currentInvestigation,
    })
    let subscription = 0
    const fakeClient = client({
      listIncidents: async () => ({ incidents: [current] }),
      getInvestigation: async () => ({ investigation: currentInvestigation }),
      subscribeEvents: (id, options) => {
        calls.push([id, options?.afterSequence])
        subscription += 1
        if (subscription === 1) {
          return (async function* () {
            yield {
              investigationId: id,
              sequence: 3,
              timestamp: "2026-07-17T09:00:03.000Z",
              kind: "output.delta" as const,
              payload: { text: "stale-secret-output" },
            }
            yield {
              investigationId: id,
              sequence: 4,
              timestamp: "2026-07-17T09:00:04.000Z",
              kind: "output.delta" as const,
              payload: { text: "fresh-secret-output" },
            }
          })()
        }
        return (async function* () {
          yield {
            investigationId: id,
            sequence: 5,
            timestamp: "2026-07-17T09:00:05.000Z",
            kind: "investigation.completed" as const,
            payload: { status: "completed" },
          }
        })()
      },
    })

    const setup = await renderConnected(fakeClient)
    const frame = await waitForFrame(setup, (value) => value.includes("Status: COMPLETED"))

    expect(calls).toEqual([
      ["investigation-1", 3],
      ["investigation-1", 4],
    ])
    expect(frame).toContain("#5")
    expect(frame).not.toContain("stale-secret-output")
    expect(frame).not.toContain("fresh-secret-output")
  })

  test("keeps an upstream failure out of the terminal and refreshes the authoritative incident after replay expiry", async () => {
    const initialInvestigation = investigation()
    const refreshedInvestigation = investigation({
        status: "completed",
        lastSequence: 7,
      })
    const initial = incident({ investigation: initialInvestigation })
    const readCalls: string[] = []
    let investigationRead = 0
    const fakeClient = client({
      listIncidents: async () => ({ incidents: [initial] }),
      getInvestigation: async (id) => {
        readCalls.push(id)
        investigationRead += 1
        return { investigation: investigationRead === 1 ? initialInvestigation : refreshedInvestigation }
      },
      subscribeEvents: () => (async function* () {
        throw new Error('Podo event stream failed (409): {"error":"event_replay_expired","detail":"sensitive upstream detail"}')
      })(),
    })

    const setup = await renderConnected(fakeClient)
    const frame = await waitForFrame(setup, (value) => value.includes("Status: COMPLETED"))

    expect(readCalls).toEqual(["investigation-1", "investigation-1"])
    expect(frame).not.toContain("sensitive upstream detail")
  })

  test.each([
    [
      "approve",
      "a",
      investigation({
        status: "waiting_for_approval",
        pendingApproval: { id: "approval-1", kind: "command", status: "pending" },
      }),
    ],
    [
      "deny",
      "d",
      investigation({
        status: "waiting_for_approval",
        pendingApproval: { id: "approval-1", kind: "command", status: "pending" },
      }),
    ],
    ["cancel", "c", investigation({ status: "running" })],
  ] as const)("forwards an explicit %s action to the selected Core-linked investigation", async (action, key, selectedInvestigation) => {
    const calls: unknown[][] = []
    const selectedIncident = incident({ investigation: selectedInvestigation })
    const fakeClient = client({
      listIncidents: async () => ({ incidents: [selectedIncident] }),
      getInvestigation: async () => ({ investigation: selectedInvestigation }),
      subscribeEvents: (_id, options) => waitForCancellation(options?.signal),
      approve: async (id, approvalId) => {
        calls.push(["approve", id, approvalId])
        return {
          investigation: investigation({ status: "running", lastSequence: selectedInvestigation.lastSequence + 1 }),
          approval: { id: approvalId, kind: "command", status: "approved" },
        }
      },
      deny: async (id, approvalId) => {
        calls.push(["deny", id, approvalId])
        return {
          investigation: investigation({ status: "running", lastSequence: selectedInvestigation.lastSequence + 1 }),
          approval: { id: approvalId, kind: "command", status: "denied" },
        }
      },
      cancel: async (id) => {
        calls.push(["cancel", id])
        return { investigation: investigation({ status: "cancelled", lastSequence: selectedInvestigation.lastSequence + 1 }) }
      },
    })

    const setup = await renderConnected(fakeClient)
    await waitForFrame(setup, (value) => action === "cancel" ? value.includes("Status: RUNNING") : value.includes("WAITING FOR APPROVAL"))
    await act(async () => {
      setup.mockInput.pressKey(key)
      await setup.renderOnce()
    })

    await waitForFrame(setup, (value) => action === "cancel" ? value.includes("Status: CANCELLED") : value.includes("Status: RUNNING"))
    expect(calls).toEqual(action === "cancel"
      ? [["cancel", "investigation-1"]]
      : [[action, "investigation-1", "approval-1"]])
  })
})
