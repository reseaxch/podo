export type ApprovalStatus = "pending" | "approved" | "denied" | "expired"

export type ApprovalRisk = "critical" | "high" | "medium"

export type ApprovalCheck = {
  id: string
  label: string
  detail: string
  status: "passed" | "warning" | "blocked"
}

export type ApprovalRequest = {
  id: string
  incidentId: string
  title: string
  summary: string
  kind: "pull_request" | "command" | "permission"
  status: ApprovalStatus
  risk: ApprovalRisk
  environment: "sandbox" | "staging" | "production"
  service: string
  requestedBy: { name: string; initials: string }
  requestedAt: string
  age: string
  expiresAt: string | null
  action: string
  scope: string[]
  evidence: string[]
  checks: ApprovalCheck[]
  policyId: string
  canApprove: boolean
  blockedReason: string | null
}

export type ApprovalHistoryItem = {
  id: string
  requestId: string
  title: string
  incidentId: string
  decision: Exclude<ApprovalStatus, "pending">
  actor: string
  decidedAt: string
  reason: string
}

export type SafetyPolicy = {
  id: string
  name: string
  description: string
  mode: "enforced" | "monitor"
  coverage: string
  rules: string[]
}

export type SafetyApprovalsViewModel = {
  revision: number
  owner: { name: string; avatar: string }
  generatedAt: string
  currentActor: string
  requests: ApprovalRequest[]
  history: ApprovalHistoryItem[]
  policies: SafetyPolicy[]
}

export type ApprovalDecisionInput = {
  requestId: string
  decision: "approve" | "deny"
  reason: string
  expectedStatus: "pending"
  expectedRevision: number
}

export type SafetyApprovalsController = {
  decide(input: ApprovalDecisionInput): Promise<SafetyApprovalsViewModel>
}
