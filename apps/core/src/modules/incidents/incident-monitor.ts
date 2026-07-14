import {
  InMemoryTelemetryStore,
  stableId,
  type TelemetryEvent,
} from "../telemetry"
import type {
  DetectedIncident,
  IncidentEvidence,
  IncidentReaction,
  TelemetryEventInput,
  TelemetryIngestionResult,
} from "@rootline/contracts"

const MIB = 1024 * 1024

export interface IncidentMonitorResult {
  ingestion: TelemetryIngestionResult
  reaction: IncidentReaction
  incident: DetectedIncident | null
}

interface SignalGroup {
  service: string
  deploymentId: string
  heap: TelemetryEvent[]
  failures: TelemetryEvent[]
}

interface DetectionDecision {
  reaction: IncidentReaction
  evidence: TelemetryEvent[]
}

export class IncidentMonitor {
  private readonly telemetry = new InMemoryTelemetryStore()
  private readonly incidents = new Map<string, DetectedIncident>()

  ingest(inputs: readonly TelemetryEventInput[]): IncidentMonitorResult {
    const ingestion = this.telemetry.ingest(inputs)
    const decision = detectCacheGrowth(this.telemetry.list())
    if (decision.reaction.action !== "open_incident") {
      return { ingestion, reaction: decision.reaction, incident: null }
    }

    const { service, deploymentId } = decision.reaction
    const id = stableId("incident", { detector: "cache_growth", service, deploymentId })
    const evidence = decision.evidence.map(toEvidence)
    const latest = evidence.at(-1)?.observedAt
    if (!latest) {
      return {
        ingestion,
        reaction: {
          action: "hold_for_more_evidence",
          detector: "cache_growth",
          service,
          deploymentId,
          reason: "Detector did not produce referenceable evidence",
        },
        incident: null,
      }
    }

    const existing = this.incidents.get(id)
    const incident: DetectedIncident = {
      id,
      status: "detected",
      detector: "cache_growth",
      affectedService: service,
      deploymentId,
      createdAt: existing?.createdAt ?? latest,
      updatedAt: latest,
      evidence,
    }
    this.incidents.set(id, incident)
    return { ingestion, reaction: decision.reaction, incident: structuredClone(incident) }
  }

  listIncidents(): DetectedIncident[] {
    return [...this.incidents.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((incident) => structuredClone(incident))
  }

  getIncident(id: string): DetectedIncident | null {
    const incident = this.incidents.get(id)
    return incident ? structuredClone(incident) : null
  }
}

function detectCacheGrowth(events: readonly TelemetryEvent[]): DetectionDecision {
  const groups = groupSignals(events)
  const qualified = groups.find(isQualifiedCacheGrowth)
  if (qualified) {
    return {
      reaction: {
        action: "open_incident",
        detector: "cache_growth",
        service: qualified.service,
        deploymentId: qualified.deploymentId,
        reason: "Sustained heap growth is corroborated by repeated runtime failures",
      },
      evidence: relevantEvidence(qualified),
    }
  }

  const partial = groups.find(hasPartialSignal)
  if (partial) {
    return {
      reaction: {
        action: "hold_for_more_evidence",
        detector: "cache_growth",
        service: partial.service,
        deploymentId: partial.deploymentId,
        reason: describeMissingEvidence(partial),
      },
      evidence: relevantEvidence(partial),
    }
  }

  return {
    reaction: {
      action: "ignore_healthy",
      detector: "cache_growth",
      reason: "No incident signal crossed the configured evidence gates",
    },
    evidence: [],
  }
}

function groupSignals(events: readonly TelemetryEvent[]): SignalGroup[] {
  const groups = new Map<string, SignalGroup>()
  for (const event of events) {
    if (!event.deploymentId) continue
    const key = `${event.service}\u0000${event.deploymentId}`
    const group = groups.get(key) ?? {
      service: event.service,
      deploymentId: event.deploymentId,
      heap: [],
      failures: [],
    }
    if (event.kind === "metric" && event.metric?.name === "process.heap.used" && event.metric.unit === "By") group.heap.push(event)
    if (isRuntimeFailure(event)) group.failures.push(event)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => {
    const signalDifference = signalScore(right) - signalScore(left)
    return signalDifference || left.service.localeCompare(right.service) || left.deploymentId.localeCompare(right.deploymentId)
  })
}

function isQualifiedCacheGrowth(group: SignalGroup): boolean {
  return hasSustainedHeapGrowth(group) && group.failures.length >= 2
}

function hasSustainedHeapGrowth(group: SignalGroup): boolean {
  if (group.heap.length < 4) return false
  const values = group.heap.map((event) => event.metric!.value)
  const growth = values.at(-1)! - values[0]!
  const monotonic = values.slice(1).every((value, index) => value > values[index]!)
  return monotonic && growth >= 128 * MIB && values.at(-1)! >= 512 * MIB
}

function hasPartialSignal(group: SignalGroup): boolean {
  if (group.failures.length > 0) return true
  if (group.heap.length < 2) return false
  const first = group.heap[0]!.metric!.value
  const latest = group.heap.at(-1)!.metric!.value
  return latest >= 512 * MIB || latest - first >= 128 * MIB
}

function isRuntimeFailure(event: TelemetryEvent): boolean {
  if (event.severity !== "error" && event.severity !== "critical") return false
  const message = event.message.toLowerCase()
  return /\b500\b|heap out of memory|allocation failure/.test(message)
}

function signalScore(group: SignalGroup): number {
  const latest = group.heap.at(-1)?.metric?.value ?? 0
  const first = group.heap[0]?.metric?.value ?? latest
  return group.failures.length * 1_000_000 + Math.max(0, latest - first) / MIB
}

function describeMissingEvidence(group: SignalGroup): string {
  if (group.heap.length < 4) return "At least four comparable heap samples are required"
  if (!hasSustainedHeapGrowth(group)) return "Heap samples do not establish sustained growth above the pressure threshold"
  return "At least two corroborating runtime failures are required"
}

function relevantEvidence(group: SignalGroup): TelemetryEvent[] {
  return [...group.heap, ...group.failures]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id))
}

function toEvidence(event: TelemetryEvent): IncidentEvidence {
  const deploymentId = event.deploymentId
  if (!deploymentId) throw new Error("incident evidence requires a deployment id")
  return {
    id: stableId("evidence", { sourceEventId: event.id, detector: "cache_growth" }),
    sourceEventId: event.id,
    sourceType: event.kind,
    observedAt: event.timestamp,
    service: event.service,
    deploymentId,
  }
}
