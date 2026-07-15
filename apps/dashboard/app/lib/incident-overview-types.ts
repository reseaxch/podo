export type IncidentOverviewStatus =
  "Investigating" | "Awaiting approval" | "Monitoring" | "Resolved"

export type IncidentSummary = {
  id: string
  title: string
  severity: "P1" | "P2" | "P3"
  status: IncidentOverviewStatus
  service: string
  diagnosis: string
  confidence: number | null
  evidenceCount: number
  updated: string
  owner: { name: string; initials: string }
  hasWorkspace: boolean
}

export type IncidentOverviewViewModel = {
  owner: { name: string; avatar: string }
  generatedAt: string
  incidents: IncidentSummary[]
}
