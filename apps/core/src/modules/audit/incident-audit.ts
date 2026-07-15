import type { IncidentAuditEvent } from "@podo/contracts"

type IncidentAuditInput = IncidentAuditEvent extends infer Event
  ? Event extends IncidentAuditEvent
    ? Omit<Event, "sequence" | "occurredAt" | "incidentId">
    : never
  : never

export const INCIDENT_AUDIT_EVENT_LOG_LIMIT = 256

export class IncidentAuditStore {
  private readonly eventsByIncident = new Map<string, IncidentAuditEvent[]>()

  constructor(private readonly eventLogLimit = INCIDENT_AUDIT_EVENT_LOG_LIMIT) {
    if (!Number.isSafeInteger(eventLogLimit) || eventLogLimit < 1) {
      throw new Error("invalid_incident_audit_event_log_limit")
    }
  }

  append(incidentId: string, input: IncidentAuditInput): void {
    const events = this.eventsByIncident.get(incidentId) ?? []
    const payload = validateInput(input)
    events.push({
      ...payload,
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      occurredAt: new Date().toISOString(),
      incidentId,
    } as IncidentAuditEvent)
    if (events.length > this.eventLogLimit) events.splice(0, events.length - this.eventLogLimit)
    this.eventsByIncident.set(incidentId, events)
  }

  get(incidentId: string): IncidentAuditEvent[] {
    return structuredClone(this.eventsByIncident.get(incidentId) ?? [])
  }
}

function validateInput(input: unknown): IncidentAuditInput {
  let value: unknown
  try { value = structuredClone(input) } catch { throw invalidEvent() }
  if (!isRecord(value) || typeof value.kind !== "string") throw invalidEvent()
  switch (value.kind) {
    case "investigation.requested":
      if (!hasExactKeys(value, ["kind"])) throw invalidEvent()
      break
    case "investigation.started":
    case "investigation.completed":
    case "investigation.failed":
    case "investigation.cancelled":
      if (!hasExactKeys(value, ["kind", "investigationId"]) || !isIdentifier(value.investigationId)) throw invalidEvent()
      break
    case "investigation.approval_denied":
      if (!hasExactKeys(value, ["kind", "investigationId", "approvalKind"])
        || !isIdentifier(value.investigationId)
        || (value.approvalKind !== "command"
          && value.approvalKind !== "file_change"
          && value.approvalKind !== "permissions"
          && value.approvalKind !== "user_input")) throw invalidEvent()
      break
    case "investigation.diagnosis_validated":
      if (!hasExactKeys(value, ["kind", "investigationId", "evidenceIds"])
        || !isIdentifier(value.investigationId)
        || !isIdentifierList(value.evidenceIds)) throw invalidEvent()
      break
    case "investigation.diagnosis_rejected":
      if (!hasExactKeys(value, ["kind", "investigationId", "code"])
        || !isIdentifier(value.investigationId)
        || (value.code !== "invalid_output"
          && value.code !== "affected_service_mismatch"
          && value.code !== "investigation_failed"
          && value.code !== "investigation_cancelled")) throw invalidEvent()
      break
    default:
      throw invalidEvent()
  }
  return value as IncidentAuditInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",")
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value === value.trim()
}

function isIdentifierList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 500
    && value.every(isIdentifier)
    && new Set(value).size === value.length
}

function invalidEvent(): Error {
  return new Error("invalid_incident_audit_event")
}
