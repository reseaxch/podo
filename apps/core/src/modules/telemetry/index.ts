import { createHash } from "node:crypto"
import type {
  RejectedTelemetryEvent,
  TelemetryEventInput,
  TelemetryIngestionResult,
  TelemetryKind,
  TelemetrySeverity,
} from "@rootline/contracts"

export type { TelemetryEventInput, TelemetryIngestionResult } from "@rootline/contracts"

export interface TelemetryEvent extends TelemetryEventInput {
  id: string
  timestamp: string
}

const KINDS = new Set<TelemetryKind>(["log", "trace", "metric"])
const SEVERITIES = new Set<TelemetrySeverity>(["debug", "info", "warn", "error", "critical"])

export class InMemoryTelemetryStore {
  private readonly byId = new Map<string, TelemetryEvent>()

  ingest(inputs: readonly TelemetryEventInput[]): TelemetryIngestionResult {
    let accepted = 0
    let duplicates = 0
    const rejected: RejectedTelemetryEvent[] = []

    inputs.forEach((input, index) => {
      const normalized = normalizeTelemetryEvent(input)
      if (typeof normalized === "string") {
        rejected.push({ index, reason: normalized })
        return
      }
      if (this.byId.has(normalized.id)) {
        duplicates += 1
        return
      }
      this.byId.set(normalized.id, normalized)
      accepted += 1
    })

    return { accepted, duplicates, rejected }
  }

  list(): TelemetryEvent[] {
    return [...this.byId.values()]
      .sort(compareTelemetryEvents)
      .map((event) => structuredClone(event))
  }
}

export function normalizeTelemetryEvent(input: TelemetryEventInput): TelemetryEvent | string {
  const timestamp = normalizeTimestamp(input.timestamp)
  if (!timestamp) return "timestamp must be a valid ISO-8601 instant"
  if (!KINDS.has(input.kind)) return "kind must be log, trace, or metric"
  if (!SEVERITIES.has(input.severity)) return "severity is not supported"
  if (!isNonEmpty(input.service)) return "service must be a non-empty string"
  if (!isNonEmpty(input.message)) return "message must be a non-empty string"
  for (const key of ["deploymentId", "commitId", "traceId", "containerId"] as const) {
    if (isPresent(input, key) && !isNonEmpty(input[key])) return `${key} must be non-empty text when present`
  }
  if (isPresent(input, "metric") && (!input.metric || typeof input.metric !== "object")) {
    return "metric must be an object when present"
  }
  if (input.kind === "metric" && !input.metric) return "metric events require metric data"
  if (input.metric && (!isNonEmpty(input.metric.name) || !Number.isFinite(input.metric.value))) {
    return "metric name and finite value are required"
  }
  if (input.metric && isPresent(input.metric, "unit") && !isNonEmpty(input.metric.unit)) {
    return "metric.unit must be non-empty text when present"
  }

  const canonical = {
    timestamp,
    kind: input.kind,
    service: input.service.trim(),
    severity: input.severity,
    message: input.message.trim(),
    ...(optionalText("deploymentId", input.deploymentId)),
    ...(optionalText("commitId", input.commitId)),
    ...(optionalText("traceId", input.traceId)),
    ...(optionalText("containerId", input.containerId)),
    ...(input.metric ? {
      metric: {
        name: input.metric.name.trim(),
        value: input.metric.value,
        ...(optionalText("unit", input.metric.unit)),
      },
    } : {}),
  } satisfies TelemetryEventInput

  return { id: stableId("telemetry", canonical), ...canonical }
}

export function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`
}

function compareTelemetryEvents(left: TelemetryEvent, right: TelemetryEvent): number {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
}

function normalizeTimestamp(value: string): string | null {
  if (!isNonEmpty(value)) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || !isValidCalendarDateTime(match)) return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) return null
  return new Date(milliseconds).toISOString()
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

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isPresent(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function optionalText<const Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, string>> {
  return isNonEmpty(value) ? { [key]: value.trim() } as Record<Key, string> : {}
}
