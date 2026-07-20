import type {
  GetIncidentTelemetryComparisonResponse,
  IncidentPostFixReplaySource,
  TelemetryComparisonReport,
  TelemetryEventInput,
  VerifiedIncidentPostFixReplay,
} from "@podo/contracts"
import { compareTelemetryWindows } from "@podo/domain"

import { IncidentMonitor } from "./incident-monitor"
import {
  normalizeTelemetryEvent,
  type TelemetryEvent,
} from "../telemetry"

const MIB = 1024 * 1024
const MAX_POST_FIX_REPLAY_EVENTS = 1_000

export type IncidentTelemetryComparisonResult =
  | {
      ok: true
      comparison: TelemetryComparisonReport
      provenance: GetIncidentTelemetryComparisonResponse["provenance"]
    }
  | {
      ok: false
      status: 404
      error: "not_found"
      message: string
    }
  | {
      ok: false
      status: 409
      error: "comparison_unavailable"
      message: string
    }

export interface IncidentTelemetryComparisonDelivery {
  remediationId: string
  artifactId: string
  headSha: string
}

export interface IncidentTelemetryComparisonDeliverySource {
  getTrustedDelivery(
    incidentId: string,
  ): IncidentTelemetryComparisonDelivery | null
}

export class IncidentTelemetryComparisonService {
  constructor(
    private readonly incidents: IncidentMonitor,
    private readonly deliveries: IncidentTelemetryComparisonDeliverySource,
    private readonly replays?: IncidentPostFixReplaySource,
  ) {}

  read(incidentId: string): IncidentTelemetryComparisonResult {
    const incident = this.incidents.getIncident(incidentId)
    if (!incident) {
      return {
        ok: false,
        status: 404,
        error: "not_found",
        message: "Incident was not found",
      }
    }
    const delivery = this.deliveries.getTrustedDelivery(incidentId)
    let replay: VerifiedIncidentPostFixReplay | null | undefined
    try {
      replay = this.replays?.getVerifiedReplay(incidentId)
    } catch {
      return unavailable()
    }
    if (
      !delivery ||
      !isVerifiedReplay(replay) ||
      replay.incidentId !== incidentId ||
      replay.remediationId !== delivery.remediationId ||
      replay.artifactId !== delivery.artifactId ||
      replay.headSha !== delivery.headSha
    ) {
      return unavailable()
    }
    const windows = this.incidents.getTelemetryComparisonWindows(
      incidentId,
      {
        commitId: replay.headSha,
        events: replay.events,
      },
    )
    if (!windows || windows.after.length === 0) {
      return unavailable()
    }
    try {
      return {
        ok: true,
        comparison: compareTelemetryWindows(windows.before, windows.after, {
          service: incident.affectedService,
          metricName: "process.heap.used",
          metricUnit: "By",
          stableChangeLimit: 16 * MIB,
        }),
        provenance: {
          replayId: replay.replayId,
          remediationId: replay.remediationId,
          artifactId: replay.artifactId,
          headSha: replay.headSha,
          afterEventCount: windows.after.length,
        },
      }
    } catch {
      return unavailable()
    }
  }
}

function isVerifiedReplay(
  value: VerifiedIncidentPostFixReplay | null | undefined,
): value is VerifiedIncidentPostFixReplay {
  try {
    return validateVerifiedReplay(value)
  } catch {
    return false
  }
}

function validateVerifiedReplay(
  value: VerifiedIncidentPostFixReplay | null | undefined,
): value is VerifiedIncidentPostFixReplay {
  if (
    !value ||
    !/^replay_[a-f0-9]{24}$/.test(value.replayId) ||
    !isSafeIdentity(value.incidentId) ||
    !isSafeIdentity(value.remediationId) ||
    !isSafeIdentity(value.artifactId) ||
    !isCommitSha(value.headSha) ||
    !Array.isArray(value.events) ||
    value.events.length === 0 ||
    value.events.length > MAX_POST_FIX_REPLAY_EVENTS
  ) {
    return false
  }
  const eventIds = new Set<string>()
  for (const input of value.events) {
    if (!hasBoundedReplayInput(input)) return false
    const event = normalizeTelemetryEvent(input)
    if (
      typeof event === "string" ||
      event.commitId !== value.headSha ||
      !hasBoundedTelemetryText(event) ||
      eventIds.has(event.id)
    ) {
      return false
    }
    const { id: _, ...normalizedInput } = event
    if (!hasExactJsonValue(normalizedInput, input)) return false
    eventIds.add(event.id)
  }
  return true
}

function hasExactJsonValue(left: unknown, right: unknown): boolean {
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return Object.is(left, right)
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        hasExactJsonValue(value, right[index])
      )
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] &&
      hasExactJsonValue(leftRecord[key], rightRecord[key])
    )
}

function hasBoundedReplayInput(value: unknown): value is TelemetryEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
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
  if (Object.keys(input).some((key) => !allowed.has(key))) return false
  if (
    !isBoundedText(input.timestamp, 64) ||
    !isBoundedText(input.kind, 16) ||
    !isBoundedText(input.service, 200) ||
    !isBoundedText(input.severity, 16) ||
    !isBoundedText(input.message, 2_000) ||
    !isOptionalBoundedText(input.deploymentId, 200) ||
    !isOptionalBoundedText(input.commitId, 64) ||
    !isOptionalBoundedText(input.traceId, 200) ||
    !isOptionalBoundedText(input.containerId, 200)
  ) {
    return false
  }
  if (input.metric === undefined) return true
  if (
    !input.metric ||
    typeof input.metric !== "object" ||
    Array.isArray(input.metric)
  ) {
    return false
  }
  const metric = input.metric as Record<string, unknown>
  return !Object.keys(metric).some(
    (key) => !["name", "value", "unit"].includes(key),
  ) &&
    isBoundedText(metric.name, 200) &&
    typeof metric.value === "number" &&
    Number.isFinite(metric.value) &&
    isOptionalBoundedText(metric.unit, 32)
}

function isSafeIdentity(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
}

function hasBoundedTelemetryText(
  event: TelemetryEvent,
): boolean {
  return isBoundedText(event.service, 200) &&
    isBoundedText(event.message, 2_000) &&
    isOptionalBoundedText(event.deploymentId, 200) &&
    isOptionalBoundedText(event.commitId, 64) &&
    isOptionalBoundedText(event.traceId, 200) &&
    isOptionalBoundedText(event.containerId, 200) &&
    (!event.metric ||
      (
        isBoundedText(event.metric.name, 200) &&
        isOptionalBoundedText(event.metric.unit, 32)
      ))
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
}

function isOptionalBoundedText(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || isBoundedText(value, maximum)
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value)
}

function unavailable(): IncidentTelemetryComparisonResult {
  return {
    ok: false,
    status: 409,
    error: "comparison_unavailable",
    message:
      "Comparable post-fix telemetry is not available for this incident",
  }
}
