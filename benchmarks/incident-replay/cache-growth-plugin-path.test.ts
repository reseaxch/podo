import { describe, expect, test } from "bun:test"
import {
  assertStableCounters,
  BenchmarkConfigurationError,
  BenchmarkResultError,
  type CounterSamples,
  decodeCounters,
  type DecodeCounters,
  loadCacheGrowthPluginInputs,
  MAX_ITERATIONS,
  replayCounters,
  type ReplayCounters,
  runCacheGrowthPluginPathBenchmark,
  validateIterations,
} from "./cache-growth-plugin-path"

const DECODE: DecodeCounters = { nodes: 35, links: 43 }
const REPLAY: ReplayCounters = {
  replayId: "replay_x",
  totalEvents: 22,
  attempted: 22,
  accepted: 22,
  batches: 16,
  scheduledDurationMs: 0,
}

const { rawGraph, rawTelemetry } = loadCacheGrowthPluginInputs()

describe("cache-growth plugin-path benchmark", () => {
  test("decodes the canonical graph into stable counters", () => {
    const first = decodeCounters(structuredClone(rawGraph))
    const second = decodeCounters(structuredClone(rawGraph))
    expect(first).toEqual({ nodes: 35, links: 43 })
    expect(second).toEqual(first)
  })

  test("replays the canonical telemetry deterministically", async () => {
    const first = await replayCounters(structuredClone(rawTelemetry))
    const second = await replayCounters(structuredClone(rawTelemetry))

    expect(first.totalEvents).toBe(22)
    expect(first.attempted).toBe(22)
    expect(first.accepted).toBe(22)
    // The replay batches events by shared timestamp instant (bounded by
    // batchSize 7), which yields 16 batches for this fixture — asserted here as
    // an observed, stable counter rather than a naive ceil(22/7).
    expect(first.batches).toBe(16)
    // Replay identity is reproducible for identical input/config.
    expect(second.replayId).toBe(first.replayId)
    expect(second).toEqual(first)
  })

  test("reports stable observable counters across iterations", async () => {
    const report = await runCacheGrowthPluginPathBenchmark(3)

    expect(report.stableCounters).toBe(true)
    expect(report.iterations).toBe(3)
    expect(report.counters.decode).toEqual({ nodes: 35, links: 43 })
    expect(report.counters.replay.totalEvents).toBe(22)
    expect(report.counters.replay.batches).toBe(16)

    // Timing arrays have one entry per iteration; durations are non-negative.
    expect(report.decode.durationMs).toHaveLength(3)
    expect(report.replay.durationMs).toHaveLength(3)
    for (const ms of [...report.decode.durationMs, ...report.replay.durationMs]) {
      expect(ms).toBeGreaterThanOrEqual(0)
    }
  })

  test("rejects invalid iteration counts before doing any work", async () => {
    // Zero, negative, fractional, non-finite, and over-limit all fail closed.
    expect(() => validateIterations(0)).toThrow(BenchmarkConfigurationError)
    expect(() => validateIterations(-1)).toThrow(BenchmarkConfigurationError)
    expect(() => validateIterations(1.5)).toThrow(BenchmarkConfigurationError)
    expect(() => validateIterations(Number.NaN)).toThrow(BenchmarkConfigurationError)
    expect(() => validateIterations(Number.POSITIVE_INFINITY)).toThrow(BenchmarkConfigurationError)
    expect(() => validateIterations(MAX_ITERATIONS + 1)).toThrow(BenchmarkConfigurationError)

    // The benchmark entry point rejects them too, before any measurement.
    await expect(runCacheGrowthPluginPathBenchmark(0)).rejects.toThrow(BenchmarkConfigurationError)
    await expect(runCacheGrowthPluginPathBenchmark(1.5)).rejects.toThrow(
      BenchmarkConfigurationError,
    )
    await expect(runCacheGrowthPluginPathBenchmark(MAX_ITERATIONS + 1)).rejects.toThrow(
      BenchmarkConfigurationError,
    )
  })

  test("accepts the bounded range endpoints", () => {
    expect(() => validateIterations(1)).not.toThrow()
    expect(() => validateIterations(MAX_ITERATIONS)).not.toThrow()
  })
})

describe("assertStableCounters (fail closed)", () => {
  test("returns the stable counters when every sample matches", () => {
    const samples: CounterSamples = {
      decode: [{ ...DECODE }, { ...DECODE }],
      replay: [{ ...REPLAY }, { ...REPLAY }],
    }
    expect(assertStableCounters(samples)).toEqual({ decode: DECODE, replay: REPLAY })
  })

  test("throws BenchmarkResultError when decode counters are missing", () => {
    const samples: CounterSamples = { decode: [], replay: [{ ...REPLAY }] }
    expect(() => assertStableCounters(samples)).toThrow(BenchmarkResultError)
    expect(() => assertStableCounters(samples)).toThrow(/no decode counters/)
  })

  test("throws BenchmarkResultError when replay counters are missing", () => {
    const samples: CounterSamples = { decode: [{ ...DECODE }], replay: [] }
    expect(() => assertStableCounters(samples)).toThrow(BenchmarkResultError)
    expect(() => assertStableCounters(samples)).toThrow(/no replay counters/)
  })

  test("throws BenchmarkResultError when decode counters drift", () => {
    const samples: CounterSamples = {
      decode: [{ ...DECODE }, { ...DECODE, links: 44 }], // drift
      replay: [{ ...REPLAY }, { ...REPLAY }],
    }
    expect(() => assertStableCounters(samples)).toThrow(BenchmarkResultError)
    expect(() => assertStableCounters(samples)).toThrow(/drifted/)
  })

  test("throws BenchmarkResultError when replay counters drift", () => {
    const samples: CounterSamples = {
      decode: [{ ...DECODE }, { ...DECODE }],
      replay: [{ ...REPLAY }, { ...REPLAY, batches: 17 }], // drift
    }
    expect(() => assertStableCounters(samples)).toThrow(BenchmarkResultError)
    expect(() => assertStableCounters(samples)).toThrow(/drifted/)
  })
})
