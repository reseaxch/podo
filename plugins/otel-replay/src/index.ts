import { createHash } from "node:crypto"
import type {
  IncidentPostFixReplayBinding,
  IncidentPostFixReplaySource,
  IngestTelemetryResponse,
  ReplaySummary,
  TelemetryEventInput,
  VerifiedIncidentPostFixReplay,
} from "@podo/contracts"
import type { PluginManifest } from "@podo/plugin-sdk"
import { parseTelemetryInstant } from "./instant"

export {
  TelemetryComparisonInputError,
  compareTelemetryWindows,
} from "@podo/domain"
export type {
  TelemetryComparisonOptions,
  TelemetryComparisonReport,
  TelemetryWindowMeasurements,
} from "@podo/contracts"

export const otelReplayPluginManifest = {
  id: "podo.otel-replay",
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

export type { ReplayRejection, ReplaySummary } from "@podo/contracts"

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

const MAX_POST_FIX_REPLAY_EVENTS = 1_000

export class InMemoryIncidentPostFixReplayRegistry
implements IncidentPostFixReplaySource {
  private readonly byIncident = new Map<
    string,
    VerifiedIncidentPostFixReplay
  >()

  async runAndSeal(
    binding: IncidentPostFixReplayBinding,
    inputs: readonly unknown[],
    options: ReplayOptions = {},
  ): Promise<VerifiedIncidentPostFixReplay | null> {
    try {
      if (
        !isReplayBinding(binding) ||
        !Array.isArray(inputs) ||
        inputs.length === 0 ||
        inputs.length > MAX_POST_FIX_REPLAY_EVENTS ||
        this.byIncident.has(binding.incidentId)
      ) {
        return null
      }
      const normalized: TelemetryEventInput[] = []
      const identities = new Set<string>()
      for (const input of inputs) {
        const event = normalizePostFixReplayEvent(input, binding.headSha)
        if (!event) return null
        const identity = stableSerialize(event)
        if (identities.has(identity)) return null
        identities.add(identity)
        normalized.push(event)
      }
      const sink = new SealedPostFixReplaySink(binding.headSha)
      let summary: ReplaySummary
      try {
        summary = await replayTelemetry(normalized, sink, options)
      } catch {
        return null
      }
      const accepted = sink.complete(summary)
      if (!accepted || this.byIncident.has(binding.incidentId)) return null
      const replay = {
        replayId: summary.replayId,
        ...structuredClone(binding),
        events: accepted,
      }
      this.byIncident.set(binding.incidentId, structuredClone(replay))
      return structuredClone(replay)
    } catch {
      return null
    }
  }

  getVerifiedReplay(incidentId: string): VerifiedIncidentPostFixReplay | null {
    const replay = this.byIncident.get(incidentId)
    return replay ? structuredClone(replay) : null
  }
}

class SealedPostFixReplaySink {
  private readonly events: TelemetryEventInput[] = []
  private readonly identities = new Set<string>()
  private attempted = 0
  private batches = 0
  private invalid = false

  constructor(private readonly headSha: string) {}

  async ingestTelemetry(
    inputs: TelemetryEventInput[],
    options?: { signal?: AbortSignal },
  ): Promise<IngestTelemetryResponse> {
    if (
      this.invalid ||
      options?.signal?.aborted ||
      !Array.isArray(inputs) ||
      inputs.length === 0 ||
      this.attempted + inputs.length > MAX_POST_FIX_REPLAY_EVENTS
    ) {
      this.invalid = true
      throw new Error("post_fix_replay_sink_rejected")
    }
    this.attempted += inputs.length
    this.batches += 1
    const rejected: Array<{ index: number; reason: string }> = []
    for (const [index, input] of inputs.entries()) {
      const normalized = normalizePostFixReplayEvent(input, this.headSha)
      const identity = normalized ? stableSerialize(normalized) : null
      if (
        !normalized ||
        JSON.stringify(normalized) !== JSON.stringify(input) ||
        !identity ||
        this.identities.has(identity)
      ) {
        rejected.push({
          index,
          reason: "event is not valid for the sealed post-fix replay",
        })
        continue
      }
      this.identities.add(identity)
      this.events.push(normalized)
    }
    if (rejected.length > 0) this.invalid = true
    return {
      ingestion: {
        accepted: inputs.length - rejected.length,
        duplicates: 0,
        rejected,
      },
      reaction: {
        action: "ignore_healthy",
        detector: "cache_growth",
        reason: "Post-fix replay evidence is isolated until sealed",
      },
      incident: null,
    }
  }

  complete(summary: ReplaySummary): TelemetryEventInput[] | null {
    if (
      this.invalid ||
      !isCompleteReplaySummary(
        summary,
        this.attempted,
        this.events.length,
        this.batches,
      )
    ) {
      return null
    }
    return structuredClone(this.events)
  }
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
    const instantMs = parseTelemetryInstant(input.timestamp)
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

function isReplayBinding(
  value: IncidentPostFixReplayBinding,
): boolean {
  return isSafeIdentity(value?.incidentId) &&
    isSafeIdentity(value?.remediationId) &&
    isSafeIdentity(value?.artifactId) &&
    typeof value?.headSha === "string" &&
    /^[a-f0-9]{40,64}$/.test(value.headSha)
}

function normalizePostFixReplayEvent(
  value: unknown,
  headSha: string,
): TelemetryEventInput | null {
  if (!isPlainRecord(value)) return null
  const allowed = new Set([
    "timestamp",
    "kind",
    "service",
    "severity",
    "message",
    "deploymentId",
    "commitId",
    "traceId",
    "containerId",
    "metric",
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (
    !isRawBoundedText(value.timestamp, 64) ||
    !["log", "trace", "metric"].includes(String(value.kind)) ||
    !isRawBoundedText(value.service, 200) ||
    !["debug", "info", "warn", "error", "critical"].includes(
      String(value.severity),
    ) ||
    !isRawBoundedText(value.message, 2_000) ||
    !isRawBoundedText(value.deploymentId, 200) ||
    !isRawBoundedText(value.commitId, 64) ||
    value.commitId.trim() !== headSha ||
    !isOptionalRawBoundedText(value.traceId, 200) ||
    !isOptionalRawBoundedText(value.containerId, 200)
  ) {
    return null
  }
  const instantMs = parseTelemetryInstant(value.timestamp)
  if (instantMs === null) return null
  let metric: TelemetryEventInput["metric"]
  if (value.metric !== undefined) {
    if (
      !isPlainRecord(value.metric) ||
      Object.keys(value.metric).some(
        (key) => !["name", "value", "unit"].includes(key),
      ) ||
      !isRawBoundedText(value.metric.name, 200) ||
      typeof value.metric.value !== "number" ||
      !Number.isFinite(value.metric.value) ||
      value.metric.value < 0 ||
      !isOptionalRawBoundedText(value.metric.unit, 32)
    ) {
      return null
    }
    metric = {
      name: value.metric.name.trim(),
      value: value.metric.value,
      ...(value.metric.unit === undefined
        ? {}
        : { unit: value.metric.unit.trim() }),
    }
  }
  if (value.kind === "metric" && !metric) return null
  return {
    timestamp: new Date(instantMs).toISOString(),
    kind: value.kind as TelemetryEventInput["kind"],
    service: value.service.trim(),
    severity: value.severity as TelemetryEventInput["severity"],
    message: value.message.trim(),
    deploymentId: value.deploymentId.trim(),
    commitId: value.commitId.trim(),
    ...(value.traceId === undefined ? {} : { traceId: value.traceId.trim() }),
    ...(value.containerId === undefined
      ? {}
      : { containerId: value.containerId.trim() }),
    ...(metric ? { metric } : {}),
  }
}

function isCompleteReplaySummary(
  value: ReplaySummary,
  attempted: number,
  accepted: number,
  batches: number,
): boolean {
  return value.status === "completed" &&
    /^replay_[a-f0-9]{24}$/.test(value.replayId) &&
    Number.isInteger(value.totalEvents) &&
    value.totalEvents > 0 &&
    value.totalEvents <= MAX_POST_FIX_REPLAY_EVENTS &&
    value.attempted === value.totalEvents &&
    value.accepted === value.totalEvents &&
    value.duplicates === 0 &&
    value.rejected === 0 &&
    Number.isInteger(value.batches) &&
    value.batches > 0 &&
    value.batches <= value.totalEvents &&
    value.batches <= MAX_POST_FIX_REPLAY_EVENTS &&
    Number.isFinite(value.scheduledDurationMs) &&
    value.scheduledDurationMs >= 0 &&
    Array.isArray(value.rejections) &&
    value.rejections.length === 0 &&
    attempted === value.totalEvents &&
    accepted === value.totalEvents &&
    batches === value.batches
}

function isSafeIdentity(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
}

function isRawBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim().length > 0
}

function isOptionalRawBoundedText(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || isRawBoundedText(value, maximum)
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
