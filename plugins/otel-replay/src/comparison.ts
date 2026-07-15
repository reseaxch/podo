import { createHash } from "node:crypto"
import { parseTelemetryInstant } from "./instant"

export interface TelemetryComparisonOptions {
  service: string
  metricName: string
  metricUnit: string
  stableChangeLimit: number
}

export interface TelemetryWindowMeasurements {
  eventCount: number
  metricSamples: number
  firstValue: number
  lastValue: number
  peakValue: number
  changeValue: number
  errorEvents: number
  deploymentIds: string[]
}

export interface TelemetryComparisonReport {
  schemaVersion: "podo.telemetry-comparison.v1"
  comparisonId: string
  service: string
  metric: {
    name: string
    unit: string
    stableChangeLimit: number
  }
  before: TelemetryWindowMeasurements
  after: TelemetryWindowMeasurements
  verdict: {
    status: "stabilized" | "unchanged" | "regressed"
    heapGrowthStable: boolean
    peakDidNotIncrease: boolean
    errorsDidNotIncrease: boolean
    improved: boolean
  }
}

export class TelemetryComparisonInputError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Telemetry comparison input is invalid: ${issues.join("; ")}`)
    this.name = "TelemetryComparisonInputError"
    this.issues = [...issues]
  }
}

interface MetricSample {
  instantMs: number
  value: number
  deploymentId?: string
}

interface MeasuredWindow {
  measurements: TelemetryWindowMeasurements
  firstInstantMs: number
  lastInstantMs: number
}

export function compareTelemetryWindows(
  beforeInput: readonly unknown[],
  afterInput: readonly unknown[],
  options: TelemetryComparisonOptions,
): TelemetryComparisonReport {
  const optionIssues = validateOptions(options)
  if (optionIssues.length > 0) throw new TelemetryComparisonInputError(optionIssues)

  const beforeWindow = measureWindow(beforeInput, "before", options)
  const afterWindow = measureWindow(afterInput, "after", options)
  if (afterWindow.firstInstantMs <= beforeWindow.lastInstantMs) {
    throw new TelemetryComparisonInputError(["after window must start strictly after the before window ends"])
  }
  const before = beforeWindow.measurements
  const after = afterWindow.measurements
  const heapGrowthStable = after.changeValue <= options.stableChangeLimit
  const peakDidNotIncrease = after.peakValue <= before.peakValue
  const errorsDidNotIncrease = after.errorEvents <= before.errorEvents
  const improved = after.changeValue < before.changeValue
    || after.peakValue < before.peakValue
    || after.errorEvents < before.errorEvents
  const regressed = after.changeValue > before.changeValue
    || after.peakValue > before.peakValue
    || after.errorEvents > before.errorEvents
  const status = regressed
    ? "regressed"
    : heapGrowthStable && peakDidNotIncrease && errorsDidNotIncrease && improved
      ? "stabilized"
      : "unchanged"
  const identity = {
    schemaVersion: "podo.telemetry-comparison.v1",
    service: options.service,
    metric: {
      name: options.metricName,
      unit: options.metricUnit,
      stableChangeLimit: options.stableChangeLimit,
    },
    before,
    after,
    verdict: { status, heapGrowthStable, peakDidNotIncrease, errorsDidNotIncrease, improved },
  } as const

  return {
    ...identity,
    comparisonId: `telemetry_comparison_${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24)}`,
  }
}

function validateOptions(options: TelemetryComparisonOptions): string[] {
  const issues: string[] = []
  if (!isBoundedText(options?.service, 200)) issues.push("service must be non-empty bounded text")
  if (!isBoundedText(options?.metricName, 200)) issues.push("metricName must be non-empty bounded text")
  if (!isBoundedText(options?.metricUnit, 32)) issues.push("metricUnit must be non-empty bounded text")
  if (!Number.isFinite(options?.stableChangeLimit) || options.stableChangeLimit < 0) {
    issues.push("stableChangeLimit must be a non-negative finite number")
  }
  return issues
}

function measureWindow(
  input: readonly unknown[],
  label: "before" | "after",
  options: TelemetryComparisonOptions,
): MeasuredWindow {
  if (!Array.isArray(input)) throw new TelemetryComparisonInputError([`${label} must be an array`])
  const issues: string[] = []
  const samples: MetricSample[] = []
  const deploymentIds = new Set<string>()
  let errorEvents = 0
  let eventCount = 0
  let firstInstantMs = Number.POSITIVE_INFINITY
  let lastInstantMs = Number.NEGATIVE_INFINITY

  input.forEach((value, index) => {
    if (!isPlainObject(value)) {
      issues.push(`${label}[${index}] must be a telemetry object`)
      return
    }
    const instantMs = parseTelemetryInstant(value.timestamp)
    if (instantMs === null) issues.push(`${label}[${index}].timestamp must be an ISO-8601 instant`)
    if (!isBoundedText(value.service, 200)) {
      issues.push(`${label}[${index}].service must be non-empty bounded text`)
      return
    }
    if (value.service !== options.service) return
    eventCount += 1
    if (instantMs !== null) {
      firstInstantMs = Math.min(firstInstantMs, instantMs)
      lastInstantMs = Math.max(lastInstantMs, instantMs)
    }

    if (value.deploymentId !== undefined) {
      if (!isBoundedText(value.deploymentId, 200)) issues.push(`${label}[${index}].deploymentId is invalid`)
      else deploymentIds.add(value.deploymentId)
    }
    if (value.severity === "error" || value.severity === "critical") errorEvents += 1

    if (!isPlainObject(value.metric) || value.metric.name !== options.metricName) return
    if (value.metric.unit !== options.metricUnit) {
      issues.push(`${label}[${index}] metric unit must be ${options.metricUnit}`)
      return
    }
    const metricValue = value.metric.value
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue) || metricValue < 0) {
      issues.push(`${label}[${index}] metric value must be a non-negative finite number`)
      return
    }
    if (instantMs !== null) {
      samples.push({
        instantMs,
        value: metricValue,
        ...(typeof value.deploymentId === "string" ? { deploymentId: value.deploymentId } : {}),
      })
    }
  })

  if (samples.length === 0) issues.push(`${label} has no matching metric samples`)
  if (issues.length > 0) throw new TelemetryComparisonInputError(issues)
  samples.sort((left, right) => left.instantMs - right.instantMs
    || left.value - right.value
    || compareCodeUnits(left.deploymentId ?? "", right.deploymentId ?? ""))
  const firstValue = samples[0]!.value
  const lastValue = samples.at(-1)!.value

  return {
    measurements: {
      eventCount,
      metricSamples: samples.length,
      firstValue,
      lastValue,
      peakValue: samples.reduce((peak, sample) => Math.max(peak, sample.value), Number.NEGATIVE_INFINITY),
      changeValue: lastValue - firstValue,
      errorEvents,
      deploymentIds: [...deploymentIds].sort(compareCodeUnits),
    },
    firstInstantMs,
    lastInstantMs,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !value.includes("\0")
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
