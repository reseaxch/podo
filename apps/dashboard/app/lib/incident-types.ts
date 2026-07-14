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

export type IncidentWorkspaceData = {
  id: string
  title: string
  severity: "P1" | "P2" | "P3"
  service: string
  elapsed: string
  owner: { name: string; avatar: string }
  evidence: Evidence[]
}

export type IncidentTab = "evidence" | "graph" | "changes"
