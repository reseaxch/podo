import type { IconName } from "./incident-types"

export type AuditCategory =
  | "Investigation"
  | "Evidence"
  | "Approval"
  | "Tool"
  | "Remediation"
  | "Delivery"
  | "System"

export type AuditOutcome = "Success" | "Pending" | "Blocked" | "Failed"

export type AuditActor = {
  id: string
  name: string
  initials: string
  type: "Agent" | "Human" | "System"
}

export type AuditEvent = {
  id: string
  occurredAt: string
  dateGroup: "Today" | "Yesterday"
  time: string
  category: AuditCategory
  outcome: AuditOutcome
  icon: IconName
  title: string
  summary: string
  actor: AuditActor
  incidentId: string | null
  service: string | null
  action: string
  resource: string
  source: string
  duration: string | null
  details: Array<{ label: string; value: string }>
  payload: Record<string, string | number | boolean | string[]>
  integrityHash: string
}

export type AuditLogViewModel = {
  owner: { name: string; avatar: string }
  generatedAt: string
  retentionDays: number
  events: AuditEvent[]
}
