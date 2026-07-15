import type {
  IncidentAuditEvent,
  IncidentRemediationAuditEvent,
} from "@podo/contracts"

import { auditLogMock } from "../mocks/audit"
import { createDashboardClient, isDemoDashboard } from "./dashboard-client"
import type {
  AuditCategory,
  AuditEvent,
  AuditLogViewModel,
  AuditOutcome,
} from "./audit-types"

const actor = {
  id: "podo-core",
  name: "Podo Core",
  initials: "PC",
  type: "System" as const,
}

function category(kind: string): AuditCategory {
  if (kind.startsWith("investigation")) return "Investigation"
  if (kind.startsWith("remediation")) return "Remediation"
  if (kind.startsWith("delivery")) return "Delivery"
  return "System"
}

function outcome(kind: string): AuditOutcome {
  if (kind.includes("failed") || kind.includes("rejected")) return "Failed"
  if (kind.includes("denied")) return "Blocked"
  if (kind.includes("requested") || kind.includes("started")) return "Pending"
  return "Success"
}

function title(kind: string) {
  return kind
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ")
}

function adapt(
  event: IncidentAuditEvent | IncidentRemediationAuditEvent,
  affectedService: string,
): AuditEvent {
  const occurredAt = event.occurredAt
  const payload = Object.fromEntries(
    Object.entries(event).filter(
      ([key, value]) =>
        !["sequence", "occurredAt", "incidentId"].includes(key) &&
        ["string", "number", "boolean"].includes(typeof value),
    ),
  ) as Record<string, string | number | boolean | string[]>
  return {
    id: `${event.incidentId}-${event.kind}-${event.sequence}`,
    occurredAt,
    dateGroup: "Today",
    time: new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(occurredAt)),
    category: category(event.kind),
    outcome: outcome(event.kind),
    icon: event.kind.startsWith("delivery") ? "git-branch" : "activity",
    title: title(event.kind),
    summary: `Authoritative Core event for ${event.incidentId}.`,
    actor,
    incidentId: event.incidentId,
    service: affectedService,
    action: event.kind,
    resource: event.incidentId,
    source: "Podo Core API",
    duration: null,
    details: Object.entries(payload).map(([label, value]) => ({
      label,
      value: String(value),
    })),
    payload,
    integrityHash: `${event.incidentId}:${event.sequence}`,
  }
}

export async function getAuditLog(): Promise<AuditLogViewModel> {
  if (isDemoDashboard()) return structuredClone(auditLogMock)

  const client = createDashboardClient()
  const { incidents } = await client.listIncidents()
  const events = (
    await Promise.all(
      incidents.map(async (incident) => {
        const investigation = await client.getIncidentAudit(incident.id)
        let remediation: IncidentRemediationAuditEvent[] = []
        try {
          remediation = (await client.getIncidentRemediationAudit(incident.id))
            .events
        } catch (error) {
          if (!(error instanceof Error && error.message.includes("(404)")))
            throw error
        }
        return [...investigation.events, ...remediation].map((event) =>
          adapt(event, incident.affectedService),
        )
      }),
    )
  )
    .flat()
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))

  return {
    owner: { name: "Podo Core", avatar: "/icon.svg" },
    generatedAt: "Updated from Core",
    retentionDays: 0,
    events,
  }
}
