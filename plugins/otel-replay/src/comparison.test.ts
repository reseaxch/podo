import { describe, expect, test } from "bun:test"
import type { TelemetryEventInput } from "@podo/contracts"

import {
  TelemetryComparisonInputError,
  compareTelemetryWindows,
  type TelemetryComparisonOptions,
} from "./comparison"

const MIB = 1024 * 1024
const options: TelemetryComparisonOptions = {
  service: "checkout-service",
  metricName: "process.heap.used",
  metricUnit: "By",
  stableChangeLimit: 16 * MIB,
}

function metric(second: number, valueMib: number, deploymentId = "deploy-test", hour = 9): TelemetryEventInput {
  return {
    timestamp: `2026-07-14T${String(hour).padStart(2, "0")}:00:${String(second).padStart(2, "0")}.000Z`,
    kind: "metric",
    service: "checkout-service",
    severity: "info",
    message: "process heap sample",
    deploymentId,
    metric: { name: "process.heap.used", value: valueMib * MIB, unit: "By" },
  }
}

function errorEvent(second: number, deploymentId = "deploy-test", hour = 9): TelemetryEventInput {
  return {
    timestamp: `2026-07-14T${String(hour).padStart(2, "0")}:00:${String(second).padStart(2, "0")}.000Z`,
    kind: "trace",
    service: "checkout-service",
    severity: "error",
    message: "POST /checkout returned 500",
    deploymentId,
    traceId: `trace-${second}`,
  }
}

describe("compareTelemetryWindows", () => {
  test("reports the canonical post-fix replay as stabilized", async () => {
    const before = await Bun.file(new URL("../../../scenarios/cache-growth/fixtures/telemetry.json", import.meta.url)).json()
    const after = await Bun.file(new URL("../../../scenarios/cache-growth/fixtures/telemetry-after-fix.json", import.meta.url)).json()

    const report = compareTelemetryWindows(before, after, options)

    expect(report).toEqual({
      schemaVersion: "podo.telemetry-comparison.v1",
      comparisonId: expect.stringMatching(/^telemetry_comparison_[a-f0-9]{24}$/),
      service: "checkout-service",
      metric: { name: "process.heap.used", unit: "By", stableChangeLimit: 16 * MIB },
      before: {
        eventCount: 22,
        metricSamples: 15,
        firstValue: 180 * MIB,
        lastValue: 642 * MIB,
        peakValue: 642 * MIB,
        changeValue: 462 * MIB,
        errorEvents: 6,
        deploymentIds: ["deploy-1041", "deploy-1042"],
      },
      after: {
        eventCount: 13,
        metricSamples: 12,
        firstValue: 180 * MIB,
        lastValue: 180 * MIB,
        peakValue: 180 * MIB,
        changeValue: 0,
        errorEvents: 0,
        deploymentIds: ["deploy-1043"],
      },
      verdict: {
        status: "stabilized",
        heapGrowthStable: true,
        peakDidNotIncrease: true,
        errorsDidNotIncrease: true,
        improved: true,
      },
    })
    expect(compareTelemetryWindows([...before].reverse(), [...after].reverse(), options)).toEqual(report)
  })

  test("distinguishes unchanged and regressed windows deterministically", () => {
    const before = [metric(0, 180), metric(1, 220), errorEvent(2)]
    const unchangedAfter = [metric(0, 180, "deploy-test", 10), metric(1, 220, "deploy-test", 10), errorEvent(2, "deploy-test", 10)]

    expect(compareTelemetryWindows(before, unchangedAfter, options).verdict.status).toBe("unchanged")
    expect(compareTelemetryWindows(before, [
      metric(0, 180, "deploy-test", 10),
      metric(1, 260, "deploy-test", 10),
      errorEvent(2, "deploy-test", 10),
      errorEvent(3, "deploy-test", 10),
    ], options))
      .toMatchObject({
        verdict: {
          status: "regressed",
          heapGrowthStable: false,
          peakDidNotIncrease: false,
          errorsDidNotIncrease: false,
        },
      })
  })

  test("fails closed for missing samples, mixed units, and malformed configuration", () => {
    for (const run of [
      () => compareTelemetryWindows([errorEvent(0)], [metric(0, 180)], options),
      () => compareTelemetryWindows([metric(0, 180)], [{ ...metric(0, 180, "deploy-test", 10), metric: { name: "process.heap.used", value: 180, unit: "MiB" } }], options),
      () => compareTelemetryWindows([metric(0, 180)], [metric(0, 180)], { ...options, stableChangeLimit: -1 }),
    ]) {
      expect(run).toThrow(TelemetryComparisonInputError)
    }
  })

  test("rejects impossible calendar instants and accepts complete boundary dates", () => {
    const validAfter = [{ ...metric(0, 180, "deploy-after", 10), timestamp: "2027-01-01T00:00:00Z" }]
    const invalidInstants = [
      "2026-02-29T09:00:00Z",
      "2026-02-30T09:00:00Z",
      "2026-04-31T09:00:00Z",
      "2026-01-01T09:00:00+24:00",
      "2026-01-01T09:00:00-24:00",
      "2026-01-01T09:00:00+23:60",
    ]

    for (const timestamp of invalidInstants) {
      expect(() => compareTelemetryWindows([{ ...metric(0, 180), timestamp }], validAfter, options))
        .toThrow(TelemetryComparisonInputError)
    }

    for (const timestamp of [
      "2024-02-29T09:00:00Z",
      "2026-04-30T09:00:00Z",
      "2026-01-01T09:00:00+23:59",
      "2026-01-01T09:00:00-23:59",
    ]) {
      expect(compareTelemetryWindows([{ ...metric(0, 180), timestamp }], validAfter, options).before.metricSamples)
        .toBe(1)
    }
  })

  test("requires the selected-service after window to start strictly after before ends", () => {
    const before = [metric(0, 180), metric(5, 190)]

    for (const after of [
      [metric(5, 180)],
      [metric(4, 180), metric(6, 181)],
    ]) {
      expect(() => compareTelemetryWindows(before, after, options)).toThrow(TelemetryComparisonInputError)
    }
  })

  test("keeps eventCount and comparison identity scoped to the selected service", () => {
    const before = [metric(0, 180), metric(1, 220)]
    const after = [metric(0, 180, "deploy-after", 10), metric(1, 182, "deploy-after", 10)]
    const report = compareTelemetryWindows(before, after, options)
    const foreignEvent = {
      ...errorEvent(2),
      service: "inventory-service",
      deploymentId: "inventory-deploy",
    }

    expect(compareTelemetryWindows([...before, foreignEvent], after, options)).toEqual(report)
    expect(report.before.eventCount).toBe(2)
  })
})
