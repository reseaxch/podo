import type {
  DetectedIncident,
  IncidentDelivery,
  IncidentIssueDelivery,
  IncidentRemediation,
} from "@podo/contracts"

export type IconName =
  | "activity"
  | "arrow-down"
  | "arrow-square-out"
  | "bell"
  | "caret-down"
  | "caret-right"
  | "caret-up"
  | "chart-line-up"
  | "check-circle"
  | "clock"
  | "code"
  | "copy"
  | "cube"
  | "database"
  | "dots-three"
  | "file-code"
  | "file-text"
  | "flag"
  | "gear-six"
  | "git-branch"
  | "git-diff"
  | "git-fork"
  | "graph"
  | "list-bullets"
  | "magnifying-glass"
  | "moon"
  | "question"
  | "rocket-launch"
  | "robot"
  | "share-network"
  | "shield-check"
  | "squares-four"
  | "stack"
  | "sun"
  | "terminal-window"
  | "trend-up"
  | "warning-circle"
  | "wrench"
  | "x"

export type Evidence = {
  id: string
  time: string
  date?: string
  icon: IconName
  source: string
  provider: string
  finding: string
  detail: string
  meta?: string
  validation: "Verified" | "High confidence"
  facts?: Array<{
    label: string
    value: string
    note?: string
  }>
}

export type RemediationReviewState = "ready" | "changes-requested" | "approved"
export type IncidentStatus =
  "Investigating" | "Mitigating" | "Monitoring" | "Resolved"

export type RemediationViewModel = {
  id: string
  reviewState: RemediationReviewState
  branch: string
  baseBranch: string
  pullRequest: { number: number; url: string } | null
}

export type RemediationController = {
  requestChanges(input: {
    incidentId: string
    remediationId: string
    feedback: string
  }): Promise<RemediationViewModel>
  approveAndCreatePullRequest(input: {
    incidentId: string
    remediationId: string
  }): Promise<RemediationViewModel>
  returnToReview(input: {
    incidentId: string
    remediationId: string
  }): Promise<RemediationViewModel>
}

export type IncidentController = RemediationController & {
  updateStatus(input: {
    incidentId: string
    expectedStatus: IncidentStatus
    status: IncidentStatus
  }): Promise<{ status: IncidentStatus }>
  executeWorkflow?(input: IncidentWorkflowCommand): Promise<void>
}

export type IncidentDiagnosisViewModel = {
  state: "not-started" | "active" | "validated" | "failed"
  eyebrow: string
  title: string
  summary: string
  probableRootCause?: string
  confidencePercent?: number
  confidenceLabel?: string
  supportingEvidence: Array<{
    id: string
    title: string
    detail: string
  }>
  checks: Array<{
    title: string
    detail: string
  }>
  affectedCode?: {
    label: string
    path: string
    evidenceId: string
  }
  actionLabel: string
}

export type IncidentGraphNodeViewModel = {
  id: string
  slot: "trigger" | "signal" | "impact" | "runtime" | "cause"
  kind: string
  title: string
  subtitle: string
  status: string
  evidenceId: string
  why: string
}

export type IncidentGraphViewModel = {
  nodes: IncidentGraphNodeViewModel[]
  confidencePercent?: number
}

export type IncidentWorkflowCommand =
  | { action: "start-investigation" }
  | { action: "start-remediation" }
  | {
      action: "decide-remediation"
      approvalId: string
      decision: "approve" | "deny"
    }
  | { action: "start-delivery" }
  | { action: "start-issue" }
  | {
      action: "decide-delivery"
      approvalId: string
      decision: "approve" | "deny"
    }

export type IncidentWorkflowViewModel = {
  incident: DetectedIncident
  remediation: IncidentRemediation | null
  delivery: IncidentDelivery | null
  issueDelivery: IncidentIssueDelivery | null
}

export type IncidentWorkspaceViewModel = {
  id: string
  title: string
  severity: "P1" | "P2" | "P3"
  service: string
  elapsed: string
  status: IncidentStatus
  owner: { name: string; avatar: string }
  evidence: Evidence[]
  remediation: RemediationViewModel
  statusEditable?: boolean
  diagnosis?: IncidentDiagnosisViewModel
  graph?: IncidentGraphViewModel
  workflow?: IncidentWorkflowViewModel
}

export type IncidentTab = "evidence" | "graph" | "changes"
