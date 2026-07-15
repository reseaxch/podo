import { createHash } from "node:crypto"
import type { IngestTelemetryResponse, TelemetryEventInput } from "@rootline/contracts"
import type { PluginManifest } from "@rootline/plugin-sdk"

export const otelReplayPluginManifest = {
  id: "rootline.otel-replay",
  displayName: "OpenTelemetry replay",
  version: "0.0.0",
  capabilities: ["telemetry_source"],
} as const satisfies PluginManifest

export interface TelemetryReplaySink {
  ingestTelemetry(events: TelemetryEventInput[], options?: { signal?: AbortSignal }): Promise<IngestTelemetryResponse>
}

export interface ReplayScheduler {
  wait(delayMs: number, signal?: AbortSignal): Promise<void>
}

export interface ReplayOptions {
  acceleration?: number
  batchSize?: number
  scheduler?: ReplayScheduler
  signal?: AbortSignal
}

export interface ReplayRejection {
  batch: number
  inputIndex: number
  reason: string
}

export interface ReplaySummary {
  status: "completed" | "aborted" | "failed"
  replayId: string
  totalEvents: number
  attempted: number
  accepted: number
  duplicates: number
  rejected: number
  batches: number
  scheduledDurationMs: number
  rejections: ReplayRejection[]
}

export interface ReplayInputIssue {
  inputIndex: number
  reason: string
}

export class ReplayInputError extends Error {
  readonly issues: ReplayInputIssue[]

  constructor(issues: ReplayInputIssue[]) {
    super(`Telemetry replay input is invalid: ${issues.map(({ inputIndex, reason }) => `[${inputIndex}] ${reason}`).join("; ")}`)
    this.name = "ReplayInputError"
    this.issues = structuredClone(issues)
  }
}

export class ReplayConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReplayConfigurationError"
  }
}

export class ReplayAbortedError extends Error {
  readonly summary: ReplaySummary

  constructor(summary: ReplaySummary, options?: ErrorOptions) {
    super("Telemetry replay was aborted", options)
    this.name = "ReplayAbortedError"
    this.summary = summary
  }
}

export class ReplaySinkError extends Error {
  readonly summary: ReplaySummary

  constructor(message: string, summary: ReplaySummary, options?: ErrorOptions) {
    super(message, options)
    this.name = "ReplaySinkError"
    this.summary = summary
  }
}

export class ReplaySchedulerError extends Error {
  readonly summary: ReplaySummary

  constructor(summary: ReplaySummary, options?: ErrorOptions) {
    super("Telemetry replay scheduler failed", options)
    this.name = "ReplaySchedulerError"
    this.summary = summary
  }
}

interface OrderedEvent {
  event: TelemetryEventInput
  inputIndex: number
  instantMs: number
  canonical: string
}

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 1_000

const defaultScheduler: ReplayScheduler = {
  wait(delayMs, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason)
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(finish, delayMs)

      function finish() {
        signal?.removeEventListener("abort", abort)
        resolve()
      }

      function abort() {
        clearTimeout(timeout)
        signal?.removeEventListener("abort", abort)
        reject(signal?.reason)
      }

      signal?.addEventListener("abort", abort, { once: true })
    })
  },
}

export async function replayTelemetry(
  inputs: readonly unknown[],
  sink: TelemetryReplaySink,
  options: ReplayOptions = {},
): Promise<ReplaySummary> {
  const acceleration = options.acceleration ?? 1
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  validateConfiguration(acceleration, batchSize)

  const ordered = validateAndOrder(inputs)
  const replayId = createReplayId(ordered, acceleration, batchSize)
  const state: ReplaySummary = {
    status: "completed",
    replayId,
    totalEvents: ordered.length,
    attempted: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    batches: 0,
    scheduledDurationMs: 0,
    rejections: [],
  }
  const snapshot = (status: ReplaySummary["status"] = state.status): ReplaySummary => ({
    ...state,
    status,
    rejections: structuredClone(state.rejections),
  })

  throwIfAborted(options.signal, snapshot)
  if (ordered.length === 0) return snapshot()

  const batches = batchByInstant(ordered, batchSize)
  let previousDispatchMs = batches[0]?.[0]?.instantMs ?? 0

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex]
    if (!batch?.length) continue
    throwIfAborted(options.signal, snapshot)

    const dispatchMs = batch[0]?.instantMs ?? previousDispatchMs
    const delayMs = (dispatchMs - previousDispatchMs) / acceleration
    if (delayMs > 0) {
      try {
        await (options.scheduler ?? defaultScheduler).wait(delayMs, options.signal)
      } catch (cause) {
        if (options.signal?.aborted) throw new ReplayAbortedError(snapshot("aborted"), { cause })
        throw new ReplaySchedulerError(snapshot("failed"), { cause })
      }
      throwIfAborted(options.signal, snapshot)
      state.scheduledDurationMs += delayMs
    }
    previousDispatchMs = dispatchMs

    state.attempted += batch.length
    state.batches += 1
    let response: IngestTelemetryResponse
    try {
      response = await raceWithAbort(
        sink.ingestTelemetry(
          batch.map(({ event }) => structuredClone(event)),
          options.signal ? { signal: options.signal } : undefined,
        ),
        options.signal,
      )
      validateSinkResponse(response, batch.length)
    } catch (cause) {
      if (options.signal?.aborted) throw new ReplayAbortedError(snapshot("aborted"), { cause })
      throw new ReplaySinkError(`Telemetry sink failed in batch ${batchIndex}`, snapshot("failed"), { cause })
    }

    state.accepted += response.ingestion.accepted
    state.duplicates += response.ingestion.duplicates
    state.rejected += response.ingestion.rejected.length
    for (const rejection of response.ingestion.rejected) {
      const source = batch[rejection.index]
      if (!source) continue
      state.rejections.push({ batch: batchIndex, inputIndex: source.inputIndex, reason: rejection.reason })
    }
    throwIfAborted(options.signal, snapshot)
  }

  return snapshot("completed")
}

function validateConfiguration(acceleration: number, batchSize: number): void {
  if (!Number.isFinite(acceleration) || acceleration <= 0) {
    throw new ReplayConfigurationError("acceleration must be a finite number greater than zero")
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new ReplayConfigurationError(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`)
  }
}

function validateAndOrder(inputs: readonly unknown[]): OrderedEvent[] {
  if (!Array.isArray(inputs)) throw new ReplayInputError([{ inputIndex: -1, reason: "input must be an array" }])
  const issues: ReplayInputIssue[] = []
  const events: OrderedEvent[] = []

  inputs.forEach((input, inputIndex) => {
    if (!isPlainRecord(input)) {
      issues.push({ inputIndex, reason: "event must be a JSON object" })
      return
    }
    const instantMs = parseInstant(input.timestamp)
    if (instantMs === null) {
      issues.push({ inputIndex, reason: "timestamp must be a valid ISO-8601 instant" })
      return
    }
    let canonical: string
    try {
      canonical = stableSerialize(input)
    } catch (cause) {
      issues.push({ inputIndex, reason: cause instanceof Error ? cause.message : "event must be JSON-compatible" })
      return
    }
    events.push({
      event: structuredClone(input) as unknown as TelemetryEventInput,
      inputIndex,
      instantMs,
      canonical,
    })
  })

  if (issues.length > 0) throw new ReplayInputError(issues)
  return events.sort((left, right) => left.instantMs - right.instantMs
    || compareCodeUnits(left.canonical, right.canonical)
    || left.inputIndex - right.inputIndex)
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || !isValidCalendarDateTime(match)) return null
  const instantMs = Date.parse(value)
  return Number.isFinite(instantMs) ? instantMs : null
}

function isValidCalendarDateTime(match: RegExpExecArray): boolean {
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]

  return daysInMonth !== undefined
    && day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
}

function stableSerialize(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("event must contain only finite JSON numbers")
    return JSON.stringify(value)
  }
  if (typeof value !== "object") throw new Error("event must be JSON-compatible")
  if (ancestors.has(value)) throw new Error("event must not contain circular references")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry, ancestors)).join(",")}]`
    if (!isPlainRecord(value)) throw new Error("event must contain only JSON objects")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], ancestors)}`).join(",")}}`
  } finally {
    ancestors.delete(value)
  }
}

function createReplayId(events: readonly OrderedEvent[], acceleration: number, batchSize: number): string {
  const canonical = JSON.stringify({ version: 1, acceleration, batchSize, events: events.map(({ canonical }) => canonical) })
  return `replay_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`
}

function validateSinkResponse(response: IngestTelemetryResponse, batchLength: number): void {
  const { accepted, duplicates, rejected } = response.ingestion
  if (!Number.isInteger(accepted) || accepted < 0 || !Number.isInteger(duplicates) || duplicates < 0 || !Array.isArray(rejected)) {
    throw new Error("sink returned invalid ingestion counters")
  }
  const indexes = new Set<number>()
  for (const item of rejected) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= batchLength || indexes.has(item.index) || typeof item.reason !== "string") {
      throw new Error("sink returned invalid rejection details")
    }
    indexes.add(item.index)
  }
  if (accepted + duplicates + rejected.length !== batchLength) {
    throw new Error("sink ingestion counters do not account for the complete batch")
  }
}

function throwIfAborted(signal: AbortSignal | undefined, snapshot: (status?: ReplaySummary["status"]) => ReplaySummary): void {
  if (signal?.aborted) throw new ReplayAbortedError(snapshot("aborted"), { cause: signal.reason })
}

function raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason)

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

function batchByInstant(items: readonly OrderedEvent[], size: number): OrderedEvent[][] {
  const batches: OrderedEvent[][] = []
  let groupStart = 0
  while (groupStart < items.length) {
    const instantMs = items[groupStart]?.instantMs
    let groupEnd = groupStart + 1
    while (groupEnd < items.length && items[groupEnd]?.instantMs === instantMs) groupEnd += 1
    for (let index = groupStart; index < groupEnd; index += size) {
      batches.push(items.slice(index, Math.min(index + size, groupEnd)))
    }
    groupStart = groupEnd
  }
  return batches
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}
