import { expect, test } from "bun:test"

import {
  PODO_TELEMETRY_COMPARISON_SCHEMA_VERSION,
  type GetIncidentTelemetryComparisonResponse,
} from "./index"

test("publishes the versioned incident telemetry comparison contract", () => {
  const response = {
    comparison: {
      schemaVersion: PODO_TELEMETRY_COMPARISON_SCHEMA_VERSION,
      comparisonId: "telemetry_comparison_0123456789abcdef01234567",
      service: "checkout-service",
      metric: {
        name: "process.heap.used",
        unit: "By",
        stableChangeLimit: 16 * 1024 * 1024,
      },
      before: {
        eventCount: 1,
        metricSamples: 1,
        firstValue: 2,
        lastValue: 2,
        peakValue: 2,
        changeValue: 0,
        errorEvents: 0,
        deploymentIds: ["deploy-before"],
      },
      after: {
        eventCount: 1,
        metricSamples: 1,
        firstValue: 1,
        lastValue: 1,
        peakValue: 1,
        changeValue: 0,
        errorEvents: 0,
        deploymentIds: ["deploy-after"],
      },
      verdict: {
        status: "stabilized",
        heapGrowthStable: true,
        peakDidNotIncrease: true,
        errorsDidNotIncrease: true,
        improved: true,
      },
    },
    provenance: {
      replayId: "replay_post_fix_1",
      remediationId: "remediation_1",
      artifactId: "artifact_1",
      headSha: "d".repeat(40),
      afterEventCount: 1,
    },
  } satisfies GetIncidentTelemetryComparisonResponse

  expect(response.comparison.schemaVersion).toBe(
    "podo.telemetry-comparison.v1",
  )
  expect(response.provenance).toMatchObject({
    replayId: "replay_post_fix_1",
    afterEventCount: 1,
  })
})
