import type { IncidentAuditEvent } from "@podo/contracts"

type IncidentAuditInput = IncidentAuditEvent extends infer Event
  ? Event extends IncidentAuditEvent
    ? Omit<Event, "sequence" | "occurredAt" | "incidentId">
    : never
  : never

export class IncidentAuditStore {
  private readonly eventsByIncident = new Map<string, IncidentAuditEvent[]>()

  append(incidentId: string, input: IncidentAuditInput): void {
    const events = this.eventsByIncident.get(incidentId) ?? []
    events.push({
      sequence: events.length + 1,
      occurredAt: new Date().toISOString(),
      incidentId,
      ...input,
    } as IncidentAuditEvent)
    this.eventsByIncident.set(incidentId, events)
  }

  get(incidentId: string): IncidentAuditEvent[] {
    return structuredClone(this.eventsByIncident.get(incidentId) ?? [])
  }
}
