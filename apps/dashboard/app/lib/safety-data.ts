import type {
  BuildIncident,
  IncidentDelivery,
  IncidentRemediation,
} from "@podo/contracts"

import {
  createDashboardClient,
  isDemoDashboard,
  isTrustedOperatorMode,
} from "./dashboard-client"
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
    id: encodeApprovalRequestId(
      "remediation",
      incidentId,
      remediation.approval.id,
    ),
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
    canApprove: isTrustedOperatorMode(),
    blockedReason: isTrustedOperatorMode()
      ? null
      : "Trusted operator mode is disabled.",
  }
}

function deliveryRequest(
  incidentId: string,
  service: string,
  delivery: IncidentDelivery,
): ApprovalRequest {
  return {
    id: encodeApprovalRequestId("delivery", incidentId, delivery.approval.id),
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
    canApprove: isTrustedOperatorMode(),
    blockedReason: isTrustedOperatorMode()
      ? null
      : "Trusted operator mode is disabled.",
  }
}

export function buildRetryRequest(
  incident: BuildIncident,
): ApprovalRequest | null {
  const retry = incident.retry
  if (!retry || retry.status !== "pending_approval") return null
  return {
    id: encodeApprovalRequestId("build-retry", incident.id, retry.approval.id),
    incidentId: incident.id,
    title: "Approve exact GitHub Actions retry",
    summary:
      "Permit Core to retry only the failed jobs from the sealed workflow run.",
    kind: "command",
    status: retry.approval.status,
    risk: "medium",
    environment: "production",
    service: incident.affectedService,
    requestedBy: { name: "Podo Core", initials: "PC" },
    requestedAt: retry.createdAt,
    age: "Core-managed",
    expiresAt: null,
    action: `Retry failed jobs for run #${incident.sourceRun.runNumber}`,
    scope: [
      incident.repository,
      `${incident.workflow.name} · run #${incident.sourceRun.runNumber}`,
      `Commit ${incident.sourceRun.headSha.slice(0, 12)}`,
      `Exact next attempt after ${incident.sourceRun.attempt}`,
    ],
    evidence: incident.evidence.map((item) => item.id),
    checks: [
      {
        id: "exact-run",
        label: "Exact retry scope sealed",
        detail:
          "Core binds repository, workflow, run, head SHA, and next attempt.",
        status: "passed",
      },
      {
        id: "operator-identity",
        label: "Trusted operator capability",
        detail: isTrustedOperatorMode()
          ? "Enabled for this private deployment."
          : "Disabled for this deployment.",
        status: isTrustedOperatorMode() ? "passed" : "blocked",
      },
    ],
    policyId: "build-retry-human-review",
    canApprove: isTrustedOperatorMode(),
    blockedReason: isTrustedOperatorMode()
      ? null
      : "Trusted operator mode is disabled.",
  }
}

export type ApprovalRequestTarget = {
  kind: "remediation" | "delivery" | "build-retry"
  incidentId: string
  approvalId: string
}

export function encodeApprovalRequestId(
  kind: ApprovalRequestTarget["kind"],
  incidentId: string,
  approvalId: string,
) {
  return [kind, incidentId, approvalId].map(encodeURIComponent).join(":")
}

export function decodeApprovalRequestId(
  id: string,
): ApprovalRequestTarget | null {
  const parts = id.split(":")
  if (parts.length !== 3) return null
  try {
    const [kind, incidentId, approvalId] = parts.map(decodeURIComponent)
    if (
      (kind !== "remediation" &&
        kind !== "delivery" &&
        kind !== "build-retry") ||
      !incidentId ||
      !approvalId
    )
      return null
    return { kind, incidentId, approvalId }
  } catch {
    return null
  }
}

async function optionalBuildIncidents(
  client: ReturnType<typeof createDashboardClient>,
) {
  try {
    return (await client.listBuildIncidents()).incidents
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("(404)") || error.message.includes("(503)"))
    )
      return []
    throw error
  }
}

export async function getSafetyApprovals(): Promise<SafetyApprovalsViewModel> {
  if (isDemoDashboard()) {
    const { safetyApprovalsMock } = await import("../mocks/safety")
    return structuredClone(safetyApprovalsMock)
  }
  const client = createDashboardClient()
  const [{ incidents }, buildIncidents] = await Promise.all([
    client.listIncidents(),
    optionalBuildIncidents(client),
  ])
  const incidentRequests = (
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
  const buildRequests = buildIncidents
    .map(buildRetryRequest)
    .filter((request): request is ApprovalRequest => request !== null)
  const requests = [...incidentRequests, ...buildRequests]

  return {
    revision: requests.reduce((sum, request) => sum + request.id.length, 0),
    owner: { name: "Podo Core", avatar: "/brand/podo-logo.png" },
    generatedAt: "Updated from Core",
    currentActor: "Not provided by Core",
    requests,
    history: [],
    policies: [],
  }
}
