export type AutonomyLevel = "observe" | "recommend" | "act_with_approval"

export type IncidentStatus =
  | "detected"
  | "investigating"
  | "awaiting_approval"
  | "remediating"
  | "resolved"
  | "failed"

export interface EvidenceReference {
  id: string
  sourceType:
    | "metric"
    | "log"
    | "trace"
    | "deployment"
    | "commit"
    | "code"
    | "test"
    | "github_actions_workflow_run"
    | "github_actions_job"
    | "github_actions_step"
  sourceId: string
}

export interface Incident {
  id: string
  status: IncidentStatus
  affectedService: string
  evidence: readonly EvidenceReference[]
  createdAt: string
}

export * from "./evidence"
export * from "./diagnosis"
export * from "./policy"
export * from "./prompts"
