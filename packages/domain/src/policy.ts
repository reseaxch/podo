import type { AutonomyLevel } from "./index"

export const REACTION_ACTIONS = [
  "read_evidence",
  "query_graph",
  "draft_diagnosis",
  "draft_issue",
  "preview_patch",
  "start_codex",
  "write_patch",
  "run_regression_tests",
  "create_pull_request",
  "create_issue",
] as const

export type ReactionAction = (typeof REACTION_ACTIONS)[number]
export type ApprovalStatus = "not_requested" | "pending" | "approved" | "denied"
export type RegressionStatus = "not_run" | "passed" | "failed"
export type ExecutionTarget = "none" | "isolated_checkout" | "default_branch" | "production"
export type ReactionReason =
  | "allowed"
  | "unknown_action"
  | "unknown_state"
  | "mode_forbidden"
  | "approval_required"
  | "approval_denied"
  | "unsafe_target"
  | "regression_failed"
  | "regression_not_passed"
  | "issue_not_required"

export interface ReactionRequest {
  mode: AutonomyLevel
  action: ReactionAction
  approval: ApprovalStatus
  regression: RegressionStatus
  target: ExecutionTarget
}

export interface ReactionDecision {
  allowed: boolean
  reason: ReactionReason
  requiresApproval: boolean
}

const knownActions = new Set<string>(REACTION_ACTIONS)
const knownModes = new Set<string>(["observe", "recommend", "act_with_approval"] satisfies readonly AutonomyLevel[])
const knownApprovals = new Set<string>(["not_requested", "pending", "approved", "denied"] satisfies readonly ApprovalStatus[])
const knownRegressions = new Set<string>(["not_run", "passed", "failed"] satisfies readonly RegressionStatus[])
const knownTargets = new Set<string>(["none", "isolated_checkout", "default_branch", "production"] satisfies readonly ExecutionTarget[])
const observeActions = new Set<ReactionAction>(["read_evidence", "query_graph"])
const recommendActions = new Set<ReactionAction>([
  ...observeActions,
  "draft_diagnosis",
  "draft_issue",
  "preview_patch",
])
const executionActions = new Set<ReactionAction>([
  "start_codex",
  "write_patch",
  "run_regression_tests",
  "create_pull_request",
  "create_issue",
])

function deny(reason: Exclude<ReactionReason, "allowed">, requiresApproval = false): ReactionDecision {
  return { allowed: false, reason, requiresApproval }
}

export function evaluateReaction(request: ReactionRequest): ReactionDecision {
  if (!knownActions.has(request.action)) return deny("unknown_action")
  if (
    !knownModes.has(request.mode)
    || !knownApprovals.has(request.approval)
    || !knownRegressions.has(request.regression)
    || !knownTargets.has(request.target)
  ) return deny("unknown_state")

  if (request.mode === "observe") {
    return observeActions.has(request.action)
      ? { allowed: true, reason: "allowed", requiresApproval: false }
      : deny("mode_forbidden")
  }

  if (request.mode === "recommend") {
    return recommendActions.has(request.action)
      ? { allowed: true, reason: "allowed", requiresApproval: false }
      : deny("mode_forbidden")
  }

  if (request.mode !== "act_with_approval") return deny("unknown_state")

  if (!executionActions.has(request.action)) {
    return recommendActions.has(request.action)
      ? { allowed: true, reason: "allowed", requiresApproval: false }
      : deny("mode_forbidden")
  }

  if (request.regression === "failed" && (request.action === "write_patch" || request.action === "create_pull_request")) {
    return deny("regression_failed", true)
  }
  if (request.approval === "denied") return deny("approval_denied", true)
  if (request.approval !== "approved") return deny("approval_required", true)
  const expectedTarget = request.action === "create_issue" ? "none" : "isolated_checkout"
  if (request.target !== expectedTarget) return deny("unsafe_target", true)
  if (request.action === "create_pull_request" && request.regression !== "passed") {
    return deny("regression_not_passed", true)
  }
  if (request.action === "create_issue" && request.regression !== "failed") {
    return deny("issue_not_required", true)
  }

  return { allowed: true, reason: "allowed", requiresApproval: true }
}
