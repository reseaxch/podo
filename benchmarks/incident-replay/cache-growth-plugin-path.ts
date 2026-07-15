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
// its logic — only the reported durations vary between iterations.

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

/** Decodes the canonical graph fixture and returns stable observable counters. */
export function runDecode(): DecodeCounters {
  const raw = JSON.parse(readFileSync(GRAPH_FIXTURE, "utf8")) as unknown
  const result = decodeGraphifyNetworkxV1(raw, { graphId: GRAPH_ID })
  if (!result.ok) {
    throw new Error(`graphify decode rejected: ${result.rejection.issues[0]?.message ?? "unknown"}`)
  }
  return { nodes: result.snapshot.nodes.length, links: result.snapshot.links.length }
}

/** Replays the canonical telemetry fixture deterministically and returns counters. */
export async function runReplay(): Promise<ReplayCounters> {
  const events = JSON.parse(readFileSync(TELEMETRY_FIXTURE, "utf8")) as TelemetryEventInput[]
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

/**
 * Runs the benchmark over N iterations. Reports per-iteration durations for each
 * phase plus the stable observable counters, which must be identical every
 * iteration (asserted via `stableCounters`).
 *
 * Memory is intentionally not reported here: a reliable retained-memory
 * measurement needs an isolated process with explicit GC control, which this
 * in-process harness does not provide. That can be added as a separate
 * benchmark later.
 */
export async function runCacheGrowthPluginPathBenchmark(
  iterations = 5,
): Promise<CacheGrowthPluginPathReport> {
  const decodeDurations: number[] = []
  const replayDurations: number[] = []

  let decodeCounters: DecodeCounters | undefined
  let replayCounters: ReplayCounters | undefined
  let stable = true

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const decode = await measure("graphify-decode", async () => runDecode())
    decodeDurations.push(decode.durationMs)

    const replay = await measure("otel-replay", () => runReplay())
    replayDurations.push(replay.durationMs)

    if (!decodeCounters) decodeCounters = decode.result
    else if (JSON.stringify(decodeCounters) !== JSON.stringify(decode.result)) stable = false

    if (!replayCounters) replayCounters = replay.result
    else if (JSON.stringify(replayCounters) !== JSON.stringify(replay.result)) stable = false
  }

  return {
    status: "ok",
    benchmark: "cache-growth-plugin-path",
    iterations,
    counters: { decode: decodeCounters!, replay: replayCounters! },
    stableCounters: stable,
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
