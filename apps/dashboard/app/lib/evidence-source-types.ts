import type { IconName } from "./incident-types"

export type EvidenceSourceCategory =
  "Observability" | "Cloud" | "Source control" | "Delivery"

export type EvidenceSourceStatus = "Connected" | "Needs attention" | "Available"

export type EvidenceSource = {
  id: string
  name: string
  provider: string
  category: EvidenceSourceCategory
  status: EvidenceSourceStatus
  icon: IconName
  description: string
  evidenceKinds: string[]
  signalCount: number
  lastSync: string
  connection: {
    instance: string
    authentication: string
    connectedBy: string
    retention: string
    permissions: string[]
  } | null
  health: {
    label: string
    detail: string
  }
}

export type EvidenceSourcesViewModel = {
  owner: { name: string; avatar: string }
  sources: EvidenceSource[]
  generatedAt: string
}

export type EvidenceSourceMutation = {
  sourceId: string
  action: "connect" | "repair"
  expectedStatus: "Available" | "Needs attention"
}

export type EvidenceSourcesController = {
  updateConnection(input: EvidenceSourceMutation): Promise<EvidenceSource>
}

export type EvidenceSourceRecord = {
  source_id: string
  display_name: string
  vendor: string
  source_kind: EvidenceSourceCategory
  connection_state: "active" | "degraded" | "not_configured"
  pictogram: IconName
  summary: string
  evidence_kinds: string[]
  signal_count_24h: number
  last_sync_label: string
  connection: {
    instance: string
    authentication: string
    connected_by: string
    retention: string
    permissions: string[]
  } | null
  health_label: string
  health_detail: string
}
