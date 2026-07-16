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
  icon: IconName
  source: string
  provider: string
  finding: string
  detail: string
  meta?: string
  validation: "Verified" | "High confidence"
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
}

export type IncidentTab = "evidence" | "graph" | "changes"
