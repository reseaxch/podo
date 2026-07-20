import type {
  BuildIncidentAuditEvent,
  IncidentAuditEvent,
  IncidentRemediationAuditEvent,
} from "@podo/contracts"

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
  if (kind.includes("approval")) return "Approval"
  if (kind.includes("evidence")) return "Evidence"
  if (kind.startsWith("investigation")) return "Investigation"
  if (kind.includes("remediation")) return "Remediation"
  if (kind.includes("delivery")) return "Delivery"
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

export function adaptCoreAuditEvent(
  event:
    | IncidentAuditEvent
    | IncidentRemediationAuditEvent
    | BuildIncidentAuditEvent,
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
    icon: event.kind.includes("delivery") ? "git-branch" : "activity",
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
    integrityHash: "Not provided by Core",
  }
}

export async function getAuditLog(): Promise<AuditLogViewModel> {
  if (isDemoDashboard()) {
    const { auditLogMock } = await import("../mocks/audit")
    return structuredClone(auditLogMock)
  }

  const client = createDashboardClient()
  const [{ incidents }, buildIncidents] = await Promise.all([
    client.listIncidents(),
    client.listBuildIncidents().catch((error: unknown) => {
      if (
        error instanceof Error &&
        (error.message.includes("(404)") || error.message.includes("(503)"))
      )
        return { incidents: [] }
      throw error
    }),
  ])
  const incidentEvents = (
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
          adaptCoreAuditEvent(event, incident.affectedService),
        )
      }),
    )
  ).flat()
  const buildEvents = (
    await Promise.all(
      buildIncidents.incidents.map(async (incident) => {
        const { events } = await client.getBuildIncidentAudit(incident.id)
        return events.map((event) =>
          adaptCoreAuditEvent(event, incident.affectedService),
        )
      }),
    )
  ).flat()
  const events = [...incidentEvents, ...buildEvents].toSorted((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  )

  return {
    owner: { name: "Podo Core", avatar: "/brand/podo-logo.png" },
    generatedAt: "Updated from Core",
    retentionDays: 0,
    events,
  }
}
