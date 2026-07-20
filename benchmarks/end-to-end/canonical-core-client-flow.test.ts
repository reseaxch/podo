import { describe, expect, test } from "bun:test"

import {
  assertFlowBudgets,
  assertStableFlowCounters,
  BenchmarkBudgetError,
  BenchmarkStabilityError,
  FULL_FLOW_BUDGET_MS,
  INVESTIGATION_BUDGET_MS,
  runCanonicalCoreClientFlowBenchmark,
  type CanonicalFlowCounters,
} from "./canonical-core-client-flow"

const STABLE_COUNTERS: CanonicalFlowCounters = {
  incidentCount: 1,
  evidenceCount: 17,
  diagnosisStatus: "validated",
  remediationStatus: "completed",
  changedFiles: [
    "demo/services/checkout-service/src/cache.test.ts",
    "demo/services/checkout-service/src/cache.ts",
  ],
  regression: {
    prePatch: "failed",
    postPatch: "passed",
  },
  validationStatus: "passed",
  deliveryStatus: "delivered",
  pullRequestNumber: 1842,
  deliveryCalls: 1,
}

describe("canonical Core/client flow benchmark", () => {
  test("runs repeated canonical flows through public contracts with stable outcomes", async () => {
    const report = await runCanonicalCoreClientFlowBenchmark(2)

    expect(report).toMatchObject({
      status: "ok",
      benchmark: "canonical-core-client-flow",
      iterations: 2,
      stableCounters: true,
      counters: STABLE_COUNTERS,
      budgets: {
        investigationMs: INVESTIGATION_BUDGET_MS,
        fullFlowMs: FULL_FLOW_BUDGET_MS,
        met: true,
      },
      externalWrites: 0,
    })
    for (const phase of [
      report.phases.detection,
      report.phases.investigation,
      report.phases.remediation,
      report.phases.delivery,
      report.phases.endToEnd,
    ]) {
      expect(phase.durationMs).toHaveLength(2)
      expect(phase.summary.min).toBeGreaterThanOrEqual(0)
      expect(phase.summary.max).toBeGreaterThanOrEqual(phase.summary.min)
      expect(phase.summary.mean).toBeGreaterThanOrEqual(phase.summary.min)
      expect(phase.summary.mean).toBeLessThanOrEqual(phase.summary.max)
      expect(phase.summary.variance).toBeGreaterThanOrEqual(0)
      expect(phase.summary.standardDeviation).toBeGreaterThanOrEqual(0)
    }
    expect(report.phases.investigation.summary.max).toBeLessThan(
      INVESTIGATION_BUDGET_MS,
    )
    expect(report.phases.endToEnd.summary.max).toBeLessThan(
      FULL_FLOW_BUDGET_MS,
    )
  }, 60_000)

  test("enforces strict investigation and full-flow MVP budgets", () => {
    expect(() =>
      assertFlowBudgets({
        investigation: [INVESTIGATION_BUDGET_MS - 1],
        endToEnd: [FULL_FLOW_BUDGET_MS - 1],
      }),
    ).not.toThrow()
    expect(() =>
      assertFlowBudgets({
        investigation: [INVESTIGATION_BUDGET_MS],
        endToEnd: [FULL_FLOW_BUDGET_MS - 1],
      }),
    ).toThrow(BenchmarkBudgetError)
    expect(() =>
      assertFlowBudgets({
        investigation: [INVESTIGATION_BUDGET_MS - 1],
        endToEnd: [FULL_FLOW_BUDGET_MS],
      }),
    ).toThrow(BenchmarkBudgetError)
    expect(() =>
      assertFlowBudgets({
        investigation: [],
        endToEnd: [1],
      }),
    ).toThrow(BenchmarkBudgetError)
  })

  test("fails closed when public flow outcomes drift between iterations", () => {
    expect(
      assertStableFlowCounters([
        structuredClone(STABLE_COUNTERS),
        structuredClone(STABLE_COUNTERS),
      ]),
    ).toEqual(STABLE_COUNTERS)
    expect(() =>
      assertStableFlowCounters([
        structuredClone(STABLE_COUNTERS),
        {
          ...structuredClone(STABLE_COUNTERS),
          deliveryStatus: "failed",
        },
      ]),
    ).toThrow(BenchmarkStabilityError)
    expect(() => assertStableFlowCounters([])).toThrow(
      BenchmarkStabilityError,
    )
  })
})
