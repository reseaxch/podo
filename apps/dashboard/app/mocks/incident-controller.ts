import type {
  RemediationController,
  RemediationViewModel,
} from "../lib/incident-types"

export function createMockIncidentController(
  incidentId: string,
  initial: RemediationViewModel,
): RemediationController {
  let current = structuredClone(initial)

  function assertScope(requestIncidentId: string, remediationId: string) {
    if (requestIncidentId !== incidentId)
      throw new Error("Incident controller scope does not match")
    if (remediationId !== current.id)
      throw new Error("Remediation is no longer available")
  }

  return {
    async requestChanges({ incidentId, remediationId, feedback }) {
      assertScope(incidentId, remediationId)
      if (!feedback.trim()) throw new Error("Feedback is required")
      if (current.reviewState === "approved")
        throw new Error("An approved remediation cannot be revised")
      current = {
        ...current,
        reviewState: "changes-requested",
        pullRequest: null,
      }
      return structuredClone(current)
    },
    async approveAndCreatePullRequest({ incidentId, remediationId }) {
      assertScope(incidentId, remediationId)
      if (current.reviewState !== "ready")
        throw new Error("Remediation is not ready for approval")
      current = {
        ...current,
        reviewState: "approved",
        pullRequest: {
          number: 1842,
          url: "https://github.com/podo/podo/pull/1842",
        },
      }
      return structuredClone(current)
    },
    async returnToReview({ incidentId, remediationId }) {
      assertScope(incidentId, remediationId)
      if (current.reviewState !== "changes-requested")
        throw new Error("No requested revision is pending")
      current = { ...current, reviewState: "ready" }
      return structuredClone(current)
    },
  }
}
