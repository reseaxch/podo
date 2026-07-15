import type {
  ApprovalDecisionInput,
  SafetyApprovalsController,
  SafetyApprovalsViewModel,
} from "../lib/safety-types"

export function createMockSafetyController(
  initial: SafetyApprovalsViewModel,
): SafetyApprovalsController {
  let current = structuredClone(initial)

  return {
    async decide(input: ApprovalDecisionInput) {
      if (input.expectedRevision !== current.revision)
        throw new Error(
          "Approval queue changed. Review the latest request before deciding.",
        )
      const request = current.requests.find(
        (item) => item.id === input.requestId,
      )
      if (!request) throw new Error("Approval request is no longer available")
      if (input.expectedStatus !== "pending" || request.status !== "pending")
        throw new Error("Approval request has already been resolved")
      if (!input.reason.trim()) throw new Error("A decision reason is required")
      if (input.decision === "approve" && !request.canApprove)
        throw new Error(
          request.blockedReason ?? "Approval is blocked by policy",
        )

      const status = input.decision === "approve" ? "approved" : "denied"
      current = {
        ...current,
        revision: current.revision + 1,
        requests: current.requests.map((item) =>
          item.id === input.requestId ? { ...item, status } : item,
        ),
        history: [
          {
            id: `DEC-${408 + current.history.length}`,
            requestId: request.id,
            title: request.title,
            incidentId: request.incidentId,
            decision: status,
            actor: current.currentActor,
            decidedAt: "Just now",
            reason: input.reason.trim(),
          },
          ...current.history,
        ],
      }
      return structuredClone(current)
    },
  }
}
