import { describe, expect, test } from "bun:test"
import { InMemoryTelemetryStore, type TelemetryEventInput } from "."

const validEvent: TelemetryEventInput = {
  timestamp: "2026-07-14T09:00:00.000Z",
  kind: "log",
  service: "checkout-service",
  severity: "info",
  message: "deployment completed",
}

describe("telemetry normalization", () => {
  test("accepts only ISO-8601 instants with an explicit timezone", () => {
    const store = new InMemoryTelemetryStore()
    const result = store.ingest([
      { ...validEvent, timestamp: "2026-07-14T11:00:00+02:00" },
      { ...validEvent, timestamp: "2026-07-14" },
      { ...validEvent, timestamp: "July 14 2026" },
      { ...validEvent, timestamp: "2026-07-14T09:00:00" },
      { ...validEvent, timestamp: "2026-02-30T09:00:00Z" },
    ])

    expect(result).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: [
        { index: 1, reason: "timestamp must be a valid ISO-8601 instant" },
        { index: 2, reason: "timestamp must be a valid ISO-8601 instant" },
        { index: 3, reason: "timestamp must be a valid ISO-8601 instant" },
        { index: 4, reason: "timestamp must be a valid ISO-8601 instant" },
      ],
    })
    expect(store.list()[0]?.timestamp).toBe("2026-07-14T09:00:00.000Z")
  })

  test("rejects optional runtime fields that are present but not non-empty text", () => {
    const inputs = [
      {
        ...validEvent,
        timestamp: "2026-07-14T09:00:01.000Z",
        kind: "metric",
        metric: { name: "request.count", value: 1 },
      },
      { ...validEvent, deploymentId: " " },
      { ...validEvent, commitId: 42 },
      { ...validEvent, traceId: null },
      { ...validEvent, containerId: {} },
      {
        ...validEvent,
        kind: "metric",
        metric: { name: "process.heap.used", value: 1, unit: "" },
      },
      {
        ...validEvent,
        kind: "metric",
        metric: { name: "process.heap.used", value: 1, unit: 42 },
      },
    ] as unknown as TelemetryEventInput[]

    expect(new InMemoryTelemetryStore().ingest(inputs)).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: [
        { index: 1, reason: "deploymentId must be non-empty text when present" },
        { index: 2, reason: "commitId must be non-empty text when present" },
        { index: 3, reason: "traceId must be non-empty text when present" },
        { index: 4, reason: "containerId must be non-empty text when present" },
        { index: 5, reason: "metric.unit must be non-empty text when present" },
        { index: 6, reason: "metric.unit must be non-empty text when present" },
      ],
    })
  })
})
