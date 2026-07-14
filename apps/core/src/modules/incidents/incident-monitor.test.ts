import { describe, expect, test } from "bun:test"
import { IncidentMonitor } from "./incident-monitor"
import type { TelemetryEventInput } from "../telemetry"

const MIB = 1024 * 1024

function metric(step: number, valueMiB: number, deploymentId = "deploy-bad"): TelemetryEventInput {
  return {
    timestamp: new Date(Date.parse("2026-07-14T09:00:00.000Z") + step * 15_000).toISOString(),
    kind: "metric",
    service: "checkout-service",
    severity: valueMiB >= 512 ? "warn" : "info",
    message: "process heap sample",
    deploymentId,
    containerId: "checkout-1",
    metric: { name: "process.heap.used", value: valueMiB * MIB, unit: "By" },
  }
}

function failure(step: number, kind: "log" | "trace", traceId: string): TelemetryEventInput {
  return {
    timestamp: new Date(Date.parse("2026-07-14T09:00:00.000Z") + step * 15_000).toISOString(),
    kind,
    service: "checkout-service",
    severity: "error",
    message: kind === "trace" ? "POST /checkout returned 500" : "JavaScript heap out of memory",
    deploymentId: "deploy-bad",
    containerId: "checkout-1",
    traceId,
  }
}

const cacheGrowth = [
  metric(0, 180),
  metric(1, 310),
  metric(2, 450),
  metric(3, 620),
  failure(4, "trace", "trace-1"),
  failure(4, "log", "trace-1"),
]

describe("IncidentMonitor", () => {
  test("opens one evidence-backed cache-growth incident deterministically", () => {
    const forward = new IncidentMonitor()
    const first = forward.ingest(cacheGrowth)

    expect(first.ingestion).toEqual({ accepted: 6, duplicates: 0, rejected: [] })
    expect(first.reaction).toMatchObject({
      action: "open_incident",
      detector: "cache_growth",
      service: "checkout-service",
      deploymentId: "deploy-bad",
    })
    expect(first.incident).toMatchObject({
      status: "detected",
      affectedService: "checkout-service",
      deploymentId: "deploy-bad",
      detector: "cache_growth",
    })
    expect(first.incident?.evidence).toHaveLength(6)
    expect(new Set(first.incident?.evidence.map((item) => item.id)).size).toBe(6)

    const reverse = new IncidentMonitor().ingest([...cacheGrowth].reverse())
    expect(reverse.incident).toEqual(first.incident)
    expect(reverse.reaction).toEqual(first.reaction)
  })

  test("deduplicates replayed events, evidence, and incident state", () => {
    const monitor = new IncidentMonitor()
    const first = monitor.ingest(cacheGrowth)
    const replay = monitor.ingest(cacheGrowth)

    expect(replay.ingestion).toEqual({ accepted: 0, duplicates: 6, rejected: [] })
    expect(replay.incident).toEqual(first.incident)
    if (!first.incident) throw new Error("expected cache-growth incident")
    expect(monitor.listIncidents()).toEqual([first.incident])
  })

  test("keeps a healthy control closed", () => {
    const monitor = new IncidentMonitor()
    const result = monitor.ingest([
      metric(0, 180, "deploy-good"),
      metric(1, 182, "deploy-good"),
      metric(2, 179, "deploy-good"),
      metric(3, 181, "deploy-good"),
    ])

    expect(result.reaction).toEqual({
      action: "ignore_healthy",
      detector: "cache_growth",
      reason: "No incident signal crossed the configured evidence gates",
    })
    expect(result.incident).toBeNull()
    expect(monitor.listIncidents()).toEqual([])
  })

  test("fails closed when noisy evidence is insufficient or invalid", () => {
    const monitor = new IncidentMonitor()
    const result = monitor.ingest([
      metric(0, 180),
      metric(1, 700),
      failure(2, "trace", "trace-only"),
      { ...metric(3, 900), timestamp: "not-a-timestamp" },
    ])

    expect(result.ingestion.accepted).toBe(3)
    expect(result.ingestion.rejected).toEqual([
      { index: 3, reason: "timestamp must be a valid ISO-8601 instant" },
    ])
    expect(result.reaction).toMatchObject({
      action: "hold_for_more_evidence",
      detector: "cache_growth",
      service: "checkout-service",
      deploymentId: "deploy-bad",
    })
    expect(result.incident).toBeNull()
    expect(monitor.listIncidents()).toEqual([])
  })

  test("does not compare heap samples without the canonical byte unit", () => {
    for (const unit of [undefined, "MiB"]) {
      const events = cacheGrowth.map((event) => {
        if (!event.metric) return event
        const metric = unit === undefined
          ? { name: event.metric.name, value: event.metric.value }
          : { ...event.metric, unit }
        return { ...event, metric }
      })
      const result = new IncidentMonitor().ingest(events)

      expect(result.reaction.action).not.toBe("open_incident")
      expect(result.incident).toBeNull()
    }
  })
})
