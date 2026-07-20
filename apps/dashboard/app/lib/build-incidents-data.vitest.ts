import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getBuildIncidentState,
  getBuildIncidents,
} from "./build-incidents-data"

describe("build incident dashboard data", () => {
  afterEach(() => {
    delete process.env.PODO_DASHBOARD_MODE
  })

  it("keeps the hosted demo independent from Core", async () => {
    process.env.PODO_DASHBOARD_MODE = "demo"
    const client = {
      listBuildIncidents: vi.fn(),
      getBuildIncident: vi.fn(),
      getBuildIncidentAudit: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof getBuildIncidents>[0]>

    const incidents = await getBuildIncidents(client)
    const state = await getBuildIncidentState(incidents[0]!.id, client)

    expect(incidents).toHaveLength(1)
    expect(state?.incident.id).toBe(incidents[0]!.id)
    expect(state?.events).toHaveLength(1)
    expect(client.listBuildIncidents).not.toHaveBeenCalled()
    expect(client.getBuildIncident).not.toHaveBeenCalled()
    expect(client.getBuildIncidentAudit).not.toHaveBeenCalled()
  })

  it("normalizes an encoded route id", async () => {
    process.env.PODO_DASHBOARD_MODE = "demo"
    const incidents = await getBuildIncidents()

    const state = await getBuildIncidentState(
      encodeURIComponent(incidents[0]!.id),
    )

    expect(state?.incident.id).toBe(incidents[0]!.id)
  })

  it("uses the typed client in live mode", async () => {
    const listBuildIncidents = vi.fn().mockResolvedValue({ incidents: [] })
    const client = { listBuildIncidents } as unknown as NonNullable<
      Parameters<typeof getBuildIncidents>[0]
    >

    expect(await getBuildIncidents(client)).toEqual([])
    expect(listBuildIncidents).toHaveBeenCalledTimes(1)
  })
})
