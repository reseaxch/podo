import type { BuildIncident, BuildIncidentAuditEvent } from "@podo/contracts"

const observedAt = "2026-07-14T10:20:00.000Z"

export const buildIncidentMock: BuildIncident = {
  id: "build:reseaxch/podo:1042:1",
  status: "awaiting_action",
  detector: "github_actions_failure",
  provider: "github_actions",
  repository: "reseaxch/podo",
  affectedService: "dashboard",
  workflow: { id: 81, name: "CI", path: ".github/workflows/ci.yml" },
  sourceRun: {
    id: 1042,
    workflowId: 81,
    workflowName: "CI",
    workflowPath: ".github/workflows/ci.yml",
    runNumber: 52,
    attempt: 1,
    event: "push",
    headBranch: "main",
    headSha: "abcdef1234567890",
    status: "completed",
    conclusion: "failure",
    createdAt: observedAt,
    updatedAt: observedAt,
    url: "https://github.com/reseaxch/podo/actions/runs/1042",
  },
  evidence: [
    {
      id: "build-evidence-step",
      sourceId: "step:4",
      sourceType: "github_actions_step",
      observedAt,
      repository: "reseaxch/podo",
      runId: 1042,
      runAttempt: 1,
      headSha: "abcdef1234567890",
      summary: "Dashboard typecheck failed",
      jobId: 77,
      jobName: "dashboard",
      stepNumber: 4,
      stepName: "Typecheck",
      status: "completed",
      conclusion: "failure",
    },
  ],
  diagnosis: {
    status: "validated",
    schemaVersion: "podo.diagnosis.v1",
    summary: "The dashboard typecheck failed after the latest commit.",
    affectedService: "dashboard",
    probableRootCause: "A route imports a missing component.",
    confidence: { value: 9100, scale: "basis_points" },
    evidenceIds: ["build-evidence-step"],
    recommendedAction: "Retry the exact failed run once.",
    safeToAttemptFix: true,
  },
  createdAt: observedAt,
  updatedAt: observedAt,
}

export const buildIncidentAuditMock: BuildIncidentAuditEvent[] = [
  {
    sequence: 1,
    occurredAt: observedAt,
    incidentId: buildIncidentMock.id,
    kind: "build.incident_created",
  },
]
