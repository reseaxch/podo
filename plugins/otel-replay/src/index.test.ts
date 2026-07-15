import { describe, expect, test } from "bun:test"
import type { IngestTelemetryResponse, TelemetryEventInput } from "@rootline/contracts"
import {
  ReplayAbortedError,
  ReplayInputError,
  ReplaySinkError,
  replayTelemetry,
  type ReplayScheduler,
  type TelemetryReplaySink,
} from "."

const immediateScheduler: ReplayScheduler = { wait: async () => {} }

function event(timestamp: string, message: string, extra: Partial<TelemetryEventInput> = {}): TelemetryEventInput {
  return {
    timestamp,
    kind: "log",
    service: "checkout-service",
    severity: "info",
    message,
    deploymentId: "deploy-1042",
    ...extra,
  }
}

function response(accepted: number, duplicates = 0, rejected: Array<{ index: number; reason: string }> = []): IngestTelemetryResponse {
  return {
    ingestion: { accepted, duplicates, rejected },
    reaction: { action: "ignore_healthy", detector: "cache_growth", reason: "test sink" },
    incident: null,
  }
}

function acceptingSink(calls: TelemetryEventInput[][]): TelemetryReplaySink {
  return {
    async ingestTelemetry(events) {
      calls.push(structuredClone(events))
      return response(events.length)
    },
  }
}

describe("replayTelemetry", () => {
  test("orders by instant and canonical content while preserving source identifiers", async () => {
    const calls: TelemetryEventInput[][] = []
    const input = [
      { ...event("2026-07-14T09:00:01.000Z", "zeta", { traceId: "trace-z" }), id: "otel-source-id" },
      event("2026-07-14T09:00:00.000Z", "first", { containerId: "container-original" }),
      event("2026-07-14T09:00:01.000Z", "alpha", { commitId: "commit-original" }),
    ]

    const summary = await replayTelemetry(input, acceptingSink(calls), {
      batchSize: 10,
      acceleration: 100,
      scheduler: immediateScheduler,
    })

    expect(calls.flat().map(({ message }) => message)).toEqual(["first", "alpha", "zeta"])
    expect(calls.flat()[0]?.containerId).toBe("container-original")
    expect(calls.flat()[1]?.commitId).toBe("commit-original")
    expect(calls.flat()[2]?.traceId).toBe("trace-z")
    expect((calls.flat()[2] as unknown as { id: string } | undefined)?.id).toBe("otel-source-id")
    expect(summary).toMatchObject({ status: "completed", totalEvents: 3, attempted: 3, accepted: 3, batches: 2 })
  })

  test("uses locale-independent code-unit ordering for equal instants", async () => {
    const calls: TelemetryEventInput[][] = []

    await replayTelemetry([
      event("2026-07-14T09:00:00.000Z", "ä-event"),
      event("2026-07-14T09:00:00.000Z", "z-event"),
    ], acceptingSink(calls), { scheduler: immediateScheduler })

    expect(calls.flat().map(({ message }) => message)).toEqual(["z-event", "ä-event"])
  })

  test("bounds batches and maps sink rejections back to original input indexes", async () => {
    const calls: TelemetryEventInput[][] = []
    let call = 0
    const sink: TelemetryReplaySink = {
      async ingestTelemetry(events) {
        calls.push(structuredClone(events))
        call += 1
        return call === 2 ? response(1, 0, [{ index: 1, reason: "core rejected event" }]) : response(events.length)
      },
    }
    const input = [4, 3, 2, 1, 0].map((item) => event("2026-07-14T09:00:00.000Z", `event-${item}`))

    const summary = await replayTelemetry(input, sink, { batchSize: 2, scheduler: immediateScheduler })

    expect(calls.map(({ length }) => length)).toEqual([2, 2, 1])
    expect(summary).toMatchObject({ attempted: 5, accepted: 4, duplicates: 0, rejected: 1, batches: 3 })
    expect(summary.rejections).toEqual([{ batch: 1, inputIndex: 1, reason: "core rejected event" }])
  })

  test("schedules scenario deltas through acceleration without sleeping in tests", async () => {
    const waits: number[] = []
    const scheduler: ReplayScheduler = {
      async wait(delayMs) {
        waits.push(delayMs)
      },
    }
    const calls: TelemetryEventInput[][] = []

    const summary = await replayTelemetry([
      event("2026-07-14T09:00:00.000Z", "zero"),
      event("2026-07-14T09:00:01.000Z", "one"),
      event("2026-07-14T09:00:05.000Z", "five"),
    ], acceptingSink(calls), { batchSize: 1, acceleration: 10, scheduler })

    expect(waits).toEqual([100, 400])
    expect(summary.scheduledDurationMs).toBe(500)
  })

  test("aborts before replay without touching the sink", async () => {
    const controller = new AbortController()
    controller.abort("cancelled before start")
    const calls: TelemetryEventInput[][] = []

    const error = await replayTelemetry([event("2026-07-14T09:00:00.000Z", "one")], acceptingSink(calls), {
      signal: controller.signal,
      scheduler: immediateScheduler,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReplayAbortedError)
    expect((error as ReplayAbortedError).summary).toMatchObject({ status: "aborted", attempted: 0, batches: 0 })
    expect(calls).toHaveLength(0)
  })

  test("aborts during a scheduled replay with an auditable partial summary", async () => {
    const controller = new AbortController()
    const calls: TelemetryEventInput[][] = []
    const scheduler: ReplayScheduler = {
      async wait() {
        controller.abort("operator cancelled")
        throw controller.signal.reason
      },
    }

    const error = await replayTelemetry([
      event("2026-07-14T09:00:00.000Z", "first"),
      event("2026-07-14T09:00:01.000Z", "second"),
    ], acceptingSink(calls), { batchSize: 1, signal: controller.signal, scheduler }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReplayAbortedError)
    expect((error as ReplayAbortedError).summary).toMatchObject({ status: "aborted", attempted: 1, accepted: 1, batches: 1 })
    expect(calls.flat().map(({ message }) => message)).toEqual(["first"])
  })

  test("returns promptly when aborted during an in-flight sink call", async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const sink: TelemetryReplaySink = {
      async ingestTelemetry(_events, options) {
        receivedSignal = options?.signal
        controller.abort("cancel in-flight request")
        return await new Promise<IngestTelemetryResponse>(() => {})
      },
    }

    const error = await replayTelemetry([event("2026-07-14T09:00:00.000Z", "first")], sink, {
      signal: controller.signal,
      scheduler: immediateScheduler,
    }).catch((caught: unknown) => caught)

    expect(receivedSignal).toBe(controller.signal)
    expect(error).toBeInstanceOf(ReplayAbortedError)
    expect((error as ReplayAbortedError).summary).toMatchObject({ status: "aborted", attempted: 1, accepted: 0, batches: 1 })
  })

  test("fails explicitly on a sink error and retains completed batch counts", async () => {
    let call = 0
    const sink: TelemetryReplaySink = {
      async ingestTelemetry(events) {
        call += 1
        if (call === 2) throw new Error("core unavailable")
        return response(events.length)
      },
    }

    const error = await replayTelemetry([
      event("2026-07-14T09:00:00.000Z", "first"),
      event("2026-07-14T09:00:01.000Z", "second"),
    ], sink, { batchSize: 1, scheduler: immediateScheduler }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReplaySinkError)
    expect((error as ReplaySinkError).cause).toEqual(new Error("core unavailable"))
    expect((error as ReplaySinkError).summary).toMatchObject({ status: "failed", attempted: 2, accepted: 1, batches: 2 })
  })

  test("keeps replay identity reproducible and permits sink-owned idempotence", async () => {
    const seen = new Set<string>()
    const sink: TelemetryReplaySink = {
      async ingestTelemetry(events) {
        let accepted = 0
        let duplicates = 0
        for (const item of events) {
          const key = JSON.stringify(item)
          if (seen.has(key)) duplicates += 1
          else {
            seen.add(key)
            accepted += 1
          }
        }
        return response(accepted, duplicates)
      },
    }
    const input = [
      event("2026-07-14T09:00:01.000Z", "second"),
      event("2026-07-14T09:00:00.000Z", "first"),
    ]
    const options = { batchSize: 1, acceleration: 20, scheduler: immediateScheduler } as const

    const first = await replayTelemetry(input, sink, options)
    const second = await replayTelemetry(input, sink, options)
    const fresh = await replayTelemetry(input, acceptingSink([]), options)

    expect(second.replayId).toBe(first.replayId)
    expect(fresh).toEqual(first)
    expect(first).toMatchObject({ accepted: 2, duplicates: 0 })
    expect(second).toMatchObject({ accepted: 0, duplicates: 2 })
  })

  test("fails closed on an unschedulable timestamp but delegates event semantics to the sink", async () => {
    const calls: TelemetryEventInput[][] = []
    const invalidTimestamp = { ...event("not-a-timestamp", "bad time") }

    const inputError = await replayTelemetry([invalidTimestamp], acceptingSink(calls), {
      scheduler: immediateScheduler,
    }).catch((caught: unknown) => caught)
    expect(inputError).toBeInstanceOf(ReplayInputError)
    expect((inputError as ReplayInputError).issues).toEqual([{ inputIndex: 0, reason: "timestamp must be a valid ISO-8601 instant" }])
    expect(calls).toHaveLength(0)

    const rejectingSink: TelemetryReplaySink = {
      async ingestTelemetry(events) {
        calls.push(structuredClone(events))
        return response(0, 0, [{ index: 0, reason: "kind must be log, trace, or metric" }])
      },
    }
    const semanticInvalid = { ...event("2026-07-14T09:00:00.000Z", "bad kind"), kind: "span" }
    const summary = await replayTelemetry([semanticInvalid], rejectingSink, { scheduler: immediateScheduler })
    expect(summary).toMatchObject({ attempted: 1, accepted: 0, rejected: 1 })
    expect((calls[0]?.[0] as unknown as { kind: string } | undefined)?.kind).toBe("span")
  })

  test("replays the canonical cache-growth fixture without copying scenario data", async () => {
    const fixtureUrl = new URL("../../../scenarios/cache-growth/fixtures/telemetry.json", import.meta.url)
    const fixture = await Bun.file(fixtureUrl).json() as unknown[]
    const calls: TelemetryEventInput[][] = []

    const summary = await replayTelemetry(fixture, acceptingSink(calls), {
      batchSize: 7,
      acceleration: 1_000,
      scheduler: immediateScheduler,
    })

    expect(fixture).toHaveLength(22)
    expect(calls.flat()).toHaveLength(22)
    expect(calls.every(({ length }) => length <= 7)).toBe(true)
    expect(summary).toMatchObject({ status: "completed", totalEvents: 22, attempted: 22, accepted: 22 })
  })
})
