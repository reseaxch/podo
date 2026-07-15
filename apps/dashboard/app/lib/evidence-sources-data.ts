import { evidenceSourceRecordsMock } from "../mocks/evidence-sources"
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

export function getEvidenceSources(): EvidenceSourcesViewModel {
  return {
    owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
    sources: evidenceSourceRecordsMock.map(adaptEvidenceSource),
    generatedAt: "Updated just now",
  }
}
