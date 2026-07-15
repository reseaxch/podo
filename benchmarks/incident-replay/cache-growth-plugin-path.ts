// Benchmark: canonical cache-growth plugin path.
//
// Measures the two deterministic plugin operations on the canonical incident
// fixtures, through the plugins' public package APIs:
//   1. Graphify NetworkX decode of scenarios/cache-growth/fixtures/graph.json;
//   2. deterministic OTEL replay of scenarios/cache-growth/fixtures/telemetry.json
//      with an injected non-sleeping scheduler and an in-memory accepting sink.
//
// It reads exclusively from the committed canonical fixtures and never copies,
// regenerates, or mutates them. All I/O is read-only; the replay sink and
// scheduler are in-memory so the run has no wall-clock or network dependence in
// its logic.
//
// Timing isolation: the fixtures are read and parsed ONCE, outside the measured
// iterations. Each timed operation clones its immutable parsed input outside the
// measured region, then measures only the public decode / replay call — so
// fixture load/parse cost never enters plugin phase timing.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { IngestTelemetryResponse, TelemetryEventInput } from "@podo/contracts"
import { decodeGraphifyNetworkxV1 } from "@podo/plugin-graphify"
import {
  replayTelemetry,
  type ReplayScheduler,
  type ReplaySummary,
  type TelemetryReplaySink,
} from "@podo/plugin-otel-replay"
import { measure } from "../src/index"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const FIXTURES = join(REPO_ROOT, "scenarios", "cache-growth", "fixtures")
const GRAPH_FIXTURE = join(FIXTURES, "graph.json")
const TELEMETRY_FIXTURE = join(FIXTURES, "telemetry.json")

// Fixed, deterministic replay configuration.
const GRAPH_ID = "cache-growth"
const BATCH_SIZE = 7
const ACCELERATION = 1_000_000

// Named, bounded positive-integer range for iteration counts.
export const MIN_ITERATIONS = 1
export const MAX_ITERATIONS = 1_000
export const DEFAULT_ITERATIONS = 5

/** Scheduler that never sleeps — replay logic runs without wall-clock waits. */
const nonSleepingScheduler: ReplayScheduler = {
  async wait() {
    // no-op: deterministic, no delay
  },
}

/** In-memory sink that accepts every event without I/O. */
function acceptingSink(): TelemetryReplaySink {
  return {
    async ingestTelemetry(events): Promise<IngestTelemetryResponse> {
      return {
        ingestion: { accepted: events.length, duplicates: 0, rejected: [] },
        reaction: { action: "ignore_healthy", detector: "cache_growth", reason: "benchmark sink" },
        incident: null,
      }
    },
  }
}

export interface DecodeCounters {
  nodes: number
  links: number
}

export interface ReplayCounters {
  replayId: string
  totalEvents: number
  attempted: number
  accepted: number
  batches: number
  scheduledDurationMs: number
}

export class BenchmarkConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BenchmarkConfigurationError"
  }
}

export class BenchmarkResultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BenchmarkResultError"
  }
}

/**
 * Validates the iteration count against the bounded positive-integer range.
 * Rejects zero, negative, fractional, non-finite, and over-limit values before
 * any measured work begins.
 */
export function validateIterations(iterations: number): void {
  if (!Number.isInteger(iterations)) {
    throw new BenchmarkConfigurationError(`iterations must be an integer, received ${iterations}`)
  }
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new BenchmarkConfigurationError(
      `iterations must be within [${MIN_ITERATIONS}, ${MAX_ITERATIONS}], received ${iterations}`,
    )
  }
}

/** Decodes an already-parsed Graphify graph and returns observable counters. */
export function decodeCounters(rawGraph: unknown): DecodeCounters {
  const result = decodeGraphifyNetworkxV1(rawGraph, { graphId: GRAPH_ID })
  if (!result.ok) {
    throw new Error(`graphify decode rejected: ${result.rejection.issues[0]?.message ?? "unknown"}`)
  }
  return { nodes: result.snapshot.nodes.length, links: result.snapshot.links.length }
}

/** Replays an already-parsed telemetry array and returns observable counters. */
export async function replayCounters(events: TelemetryEventInput[]): Promise<ReplayCounters> {
  const summary: ReplaySummary = await replayTelemetry(events, acceptingSink(), {
    batchSize: BATCH_SIZE,
    acceleration: ACCELERATION,
    scheduler: nonSleepingScheduler,
  })
  return {
    replayId: summary.replayId,
    totalEvents: summary.totalEvents,
    attempted: summary.attempted,
    accepted: summary.accepted,
    batches: summary.batches,
    scheduledDurationMs: summary.scheduledDurationMs,
  }
}

export interface CacheGrowthPluginPathReport {
  status: "ok"
  benchmark: "cache-growth-plugin-path"
  iterations: number
  counters: {
    decode: DecodeCounters
    replay: ReplayCounters
  }
  stableCounters: boolean
  decode: {
    durationMs: number[]
    durationMsSummary: { min: number; max: number; mean: number }
  }
  replay: {
    durationMs: number[]
    durationMsSummary: { min: number; max: number; mean: number }
  }
}

function summarize(values: number[]): { min: number; max: number; mean: number } {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { min, max, mean }
}

/** The per-iteration counter samples collected during a benchmark run. */
export interface CounterSamples {
  decode: DecodeCounters[]
  replay: ReplayCounters[]
}

/**
 * Pure fail-closed check over the collected counter samples.
 *
 * Throws `BenchmarkResultError` when:
 *   - no samples were captured (missing counters), or
 *   - any sample differs from the first (counters drifted between iterations).
 *
 * On success returns the single, stable counter values. Extracted as a pure
 * function so both failure modes are directly testable without running the
 * plugin path.
 */
export function assertStableCounters(samples: CounterSamples): {
  decode: DecodeCounters
  replay: ReplayCounters
} {
  const first = <T>(list: T[], label: string): T => {
    if (list.length === 0) throw new BenchmarkResultError(`benchmark produced no ${label} counters`)
    return list[0]!
  }
  const decode = first(samples.decode, "decode")
  const replay = first(samples.replay, "replay")

  const drifted = <T>(list: T[], baseline: T): boolean =>
    list.some((value) => JSON.stringify(value) !== JSON.stringify(baseline))
  if (drifted(samples.decode, decode) || drifted(samples.replay, replay)) {
    throw new BenchmarkResultError("benchmark counters drifted between iterations")
  }

  return { decode, replay }
}

/**
 * Runs the benchmark over N iterations. Reports per-iteration durations for each
 * phase plus the stable observable counters.
 *
 * - The iteration count is validated (bounded positive integer) before any work.
 * - Fixtures are read and parsed once, outside the measured loop.
 * - Each timed operation clones its immutable parsed input outside the measured
 *   region, so only the public decode / replay call is timed.
 * - If counters are never captured or drift between iterations, the run throws
 *   rather than emitting a successful report with invalid data.
 *
 * Memory is intentionally not reported here: a reliable retained-memory
 * measurement needs an isolated process with explicit GC control, which this
 * in-process harness does not provide. That can be added as a separate
 * benchmark later.
 */
export async function runCacheGrowthPluginPathBenchmark(
  iterations = DEFAULT_ITERATIONS,
): Promise<CacheGrowthPluginPathReport> {
  validateIterations(iterations)

  // Read + parse fixtures ONCE, outside the measured iterations.
  const rawGraph = JSON.parse(readFileSync(GRAPH_FIXTURE, "utf8")) as unknown
  const rawTelemetry = JSON.parse(readFileSync(TELEMETRY_FIXTURE, "utf8")) as TelemetryEventInput[]

  const decodeDurations: number[] = []
  const replayDurations: number[] = []
  const samples: CounterSamples = { decode: [], replay: [] }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    // Clone the immutable inputs OUTSIDE the measured region so decode/replay
    // each operate on a fresh copy without paying parse cost inside the timing.
    const graphInput = structuredClone(rawGraph)
    const decode = await measure("graphify-decode", async () => decodeCounters(graphInput))
    decodeDurations.push(decode.durationMs)
    samples.decode.push(decode.result)

    const telemetryInput = structuredClone(rawTelemetry)
    const replay = await measure("otel-replay", () => replayCounters(telemetryInput))
    replayDurations.push(replay.durationMs)
    samples.replay.push(replay.result)
  }

  // Counters must exist and be stable, or the report is invalid — fail closed.
  const counters = assertStableCounters(samples)

  return {
    status: "ok",
    benchmark: "cache-growth-plugin-path",
    iterations,
    counters,
    stableCounters: true,
    decode: {
      durationMs: decodeDurations,
      durationMsSummary: summarize(decodeDurations),
    },
    replay: {
      durationMs: replayDurations,
      durationMsSummary: summarize(replayDurations),
    },
  }
}
