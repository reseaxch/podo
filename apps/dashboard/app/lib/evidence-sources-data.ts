import { createDashboardClient, isDemoDashboard } from "./dashboard-client"
import type {
  EvidenceSource,
  EvidenceSourceRecord,
  EvidenceSourcesViewModel,
} from "./evidence-source-types"

const statusByRecord: Record<
  EvidenceSourceRecord["connection_state"],
  EvidenceSource["status"]
> = {
  active: "Connected",
  degraded: "Needs attention",
  not_configured: "Available",
}

export function adaptEvidenceSource(
  record: EvidenceSourceRecord,
): EvidenceSource {
  return {
    id: record.source_id,
    name: record.display_name,
    provider: record.vendor,
    category: record.source_kind,
    status: statusByRecord[record.connection_state],
    icon: record.pictogram,
    description: record.summary,
    externalUrl: record.external_url,
    evidenceKinds: record.evidence_kinds,
    signalCount: record.signal_count_24h,
    lastSync: record.last_sync_label,
    connection: record.connection
      ? {
          instance: record.connection.instance,
          authentication: record.connection.authentication,
          connectedBy: record.connection.connected_by,
          retention: record.connection.retention,
          permissions: record.connection.permissions,
        }
      : null,
    health: {
      label: record.health_label,
      detail: record.health_detail,
    },
  }
}

export async function getEvidenceSources(): Promise<EvidenceSourcesViewModel> {
  if (!isDemoDashboard()) {
    const client = createDashboardClient()
    const [{ incidents }, system] = await Promise.all([
      client.listIncidents(),
      client.systemStatus(),
    ])
    const evidence = incidents.flatMap((incident) => incident.evidence)
    const kinds = Array.from(new Set(evidence.map((item) => item.sourceType)))
    return {
      owner: { name: "Podo Core", avatar: "/icon.svg" },
      generatedAt: "Updated from Core",
      sources: [
        {
          id: "core-telemetry",
          name: "Core telemetry ingestion",
          provider: "Podo Core",
          category: "Observability",
          status: "Connected",
          icon: "activity",
          description:
            "Authoritative normalized evidence accepted by the incident engine.",
          externalUrl: "https://opentelemetry.io/",
          evidenceKinds: kinds.length
            ? kinds.map((kind) => `${kind[0]?.toUpperCase()}${kind.slice(1)}s`)
            : ["No evidence received"],
          signalCount: evidence.length,
          lastSync: "Core-owned state",
          connection: {
            instance: process.env.PODO_CORE_URL ?? "http://127.0.0.1:4100",
            authentication: "Server-side typed client",
            connectedBy: "Podo runtime",
            retention: "Core policy",
            permissions: ["telemetry:read", "incidents:read"],
          },
          health: {
            label: system.status === "ready" ? "Healthy" : "Degraded",
            detail: `${evidence.length} evidence records across ${incidents.length} incidents.`,
          },
        },
      ],
    }
  }
  const { evidenceSourceRecordsMock } =
    await import("../mocks/evidence-sources")
  return {
    owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
    sources: evidenceSourceRecordsMock.map(adaptEvidenceSource),
    generatedAt: "Updated just now",
  }
}
