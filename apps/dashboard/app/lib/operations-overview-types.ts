import type { IncidentSummary } from "./incident-overview-types"

export type OperationsOverviewSignal = {
  label: string
  value: string
  detail: string
  tone: "healthy" | "attention" | "critical"
  href: string
}

export type OperationsOverviewActivity = {
  id: string
  title: string
  detail: string
  time: string
  actor: string
  kind: "agent" | "human" | "system"
  href: string
}

export type OperationsOverviewViewModel = {
  owner: { name: string; avatar: string }
  generatedAt: string
  incidents: IncidentSummary[]
  signals: OperationsOverviewSignal[]
  activity: OperationsOverviewActivity[]
}
