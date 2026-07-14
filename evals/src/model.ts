import type { ScenarioDefinition, ScenarioDelivery, ScenarioKind } from "./scenarios"

export const autonomyModes = ["observe", "recommend", "act_with_approval"] as const
export type AutonomyMode = (typeof autonomyModes)[number]

export const nextActions = [
  "monitor",
  "present_findings",
  "preview_fix",
  "draft_issue",
  "request_approval",
  "create_issue",
  "open_pull_request",
] as const
export type NextAction = (typeof nextActions)[number]

export const approvalStates = ["not_applicable", "required", "granted", "denied"] as const
export type ApprovalState = (typeof approvalStates)[number]

export const regressionStates = ["not_run", "passed", "failed"] as const
export type RegressionState = (typeof regressionStates)[number]

export interface ReactionDecision {
  scenarioId: string
  mode: AutonomyMode
  incidentCreated: boolean
  evidenceSufficient: boolean
  nextAction: NextAction
  approval: ApprovalState
  regression: RegressionState
  delivery: ScenarioDelivery
}

export interface EvaluationCase {
  caseId: string
  scenario: ScenarioDefinition
  mode: AutonomyMode
  trustedApprovalGranted: boolean
  expected: ReactionDecision
}

export interface CandidateMetadata {
  model: string | null
  promptVersion: string | null
  codexVersion: string | null
  protocolHash: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  toolCalls: number | null
}

export interface DecisionDocument {
  schemaVersion: 1
  metadata: CandidateMetadata
  decisions: ReactionDecision[]
}

export type ScoreName =
  | "incidentDetection"
  | "evidenceSufficiency"
  | "nextAction"
  | "approvalPolicy"
  | "deliverySafety"

export type HardFailure =
  | "healthy_false_positive"
  | "unsafe_mutation"
  | "pull_request_after_failed_regression"

export interface CaseResult {
  caseId: string
  scenarioId: string
  scenarioKind: ScenarioKind
  mode: AutonomyMode
  trustedApprovalGranted: boolean
  status: "passed" | "failed"
  scores: Record<ScoreName, boolean>
  hardFailures: HardFailure[]
  expected: ReactionDecision
  actual: ReactionDecision
}

export interface ContractError {
  code: "duplicate_decision" | "missing_decision" | "unknown_decision"
  caseId: string
}

export interface EvaluationReport {
  schemaVersion: 1
  suite: "rootline-reaction-matrix"
  fixtureAdapterVersion: 2
  scenarioFingerprint: string
  status: "passed" | "failed"
  metadata: CandidateMetadata
  summary: {
    caseCount: number
    passedCases: number
    failedCases: number
    hardFailureCount: number
    score: number
  }
  metrics: Record<ScoreName, number>
  contractErrors: ContractError[]
  cases: CaseResult[]
}
