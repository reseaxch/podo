import { describe, expect, test } from "bun:test"
import {
  runCacheGrowthPluginPathBenchmark,
  runDecode,
  runReplay,
} from "./cache-growth-plugin-path"

describe("cache-growth plugin-path benchmark", () => {
  test("decodes the canonical graph into stable counters", () => {
    const first = runDecode()
    const second = runDecode()
    expect(first).toEqual({ nodes: 35, links: 43 })
    expect(second).toEqual(first)
  })

  test("replays the canonical telemetry deterministically", async () => {
    const first = await runReplay()
    const second = await runReplay()

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
})
