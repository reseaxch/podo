import type { IncidentDelivery, IncidentRemediation } from "@podo/contracts"

import { createDashboardClient, isDemoDashboard } from "./dashboard-client"
import type { ApprovalRequest, SafetyApprovalsViewModel } from "./safety-types"

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

function remediationRequest(
  incidentId: string,
  service: string,
  remediation: IncidentRemediation,
): ApprovalRequest {
  return {
    id: `remediation:${incidentId}:${remediation.approval.id}`,
    incidentId,
    title: "Approve tested remediation",
    summary: "Permit the verified remediation to run in an isolated checkout.",
    kind: "command",
    status: remediation.approval.status,
    risk: "medium",
    environment: "sandbox",
    service,
    requestedBy: { name: "Podo Core", initials: "PC" },
    requestedAt: remediation.createdAt,
    age: "Core-managed",
    expiresAt: null,
    action: "Execute evidence-backed remediation",
    scope: ["Isolated checkout", "Regression test", "No production mutation"],
    evidence: remediation.artifact?.evidenceIds ?? [],
    checks: [
      {
        id: "policy",
        label: "Approval boundary",
        detail: "A human decision is required before execution.",
        status: "passed",
      },
    ],
    policyId: "human-review-required",
    canApprove: true,
    blockedReason: null,
  }
}

function deliveryRequest(
  incidentId: string,
  service: string,
  delivery: IncidentDelivery,
): ApprovalRequest {
  return {
    id: `delivery:${incidentId}:${delivery.approval.id}`,
    incidentId,
    title: "Approve pull request delivery",
    summary:
      "Publish the exact verified tree and create the matching pull request.",
    kind: "pull_request",
    status: delivery.approval.status,
    risk: "high",
    environment: "staging",
    service,
    requestedBy: { name: "Podo Core", initials: "PC" },
    requestedAt: delivery.createdAt,
    age: "Core-managed",
    expiresAt: null,
    action: "Create pull request",
    scope: ["Derived branch", "Exact verified artifact", "No automatic merge"],
    evidence: [delivery.artifactId],
    checks: [
      {
        id: "artifact",
        label: "Verified artifact sealed",
        detail: delivery.artifactId,
        status: "passed",
      },
    ],
    policyId: "delivery-approval-required",
    canApprove: true,
    blockedReason: null,
  }
}

export async function getSafetyApprovals(): Promise<SafetyApprovalsViewModel> {
  if (isDemoDashboard()) {
    const { safetyApprovalsMock } = await import("../mocks/safety")
    return structuredClone(safetyApprovalsMock)
  }
  const client = createDashboardClient()
  const { incidents } = await client.listIncidents()
  const requests = (
    await Promise.all(
      incidents.map(async (incident) => {
        const [remediationResult, deliveryResult] = await Promise.all([
          optional(() => client.getIncidentRemediation(incident.id)),
          optional(() => client.getIncidentDelivery(incident.id)),
        ])
        const result: ApprovalRequest[] = []
        if (remediationResult?.remediation)
          result.push(
            remediationRequest(
              incident.id,
              incident.affectedService,
              remediationResult.remediation,
            ),
          )
        if (deliveryResult?.delivery)
          result.push(
            deliveryRequest(
              incident.id,
              incident.affectedService,
              deliveryResult.delivery,
            ),
          )
        return result
      }),
    )
  ).flat()

  return {
    revision: requests.reduce((sum, request) => sum + request.id.length, 0),
    owner: { name: "Podo Core", avatar: "/icon.svg" },
    generatedAt: "Updated from Core",
    currentActor: "Not provided by Core",
    requests,
    history: [],
    policies: [],
  }
}
