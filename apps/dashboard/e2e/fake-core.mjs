import { createServer } from "node:http"

const port = Number(process.env.PODO_DASHBOARD_E2E_CORE_PORT ?? 4101)
const now = "2026-07-14T10:20:00.000Z"
const evidence = {
  id: "evidence_metric",
  sourceEventId: "event_metric",
  sourceType: "metric",
  observedAt: "2026-07-14T10:05:00.000Z",
  service: "checkout-service",
  deploymentId: "deploy-1042",
}
const evidenceRecord = {
  evidence,
  event: {
    id: evidence.sourceEventId,
    timestamp: evidence.observedAt,
    kind: evidence.sourceType,
    service: evidence.service,
    severity: "warn",
    message: "process heap sample",
    deploymentId: evidence.deploymentId,
    containerId: "checkout-container",
    metric: {
      name: "process.heap.used",
      value: 620 * 1024 * 1024,
      unit: "By",
    },
  },
}
let incident
let remediation = null
let delivery = null
let buildIncident
const unsafeIssues = new Map()

function unsafeIncident(id) {
  return {
    id,
    status: "detected",
    detector: "cache_growth",
    affectedService: "checkout-service",
    deploymentId: "deploy-1042",
    createdAt: "2026-07-14T09:55:00.000Z",
    updatedAt: "2026-07-14T10:19:00.000Z",
    evidence: [evidence],
    investigation: {
      id: `investigation_${id}`,
      status: "completed",
      startedAt: now,
      updatedAt: now,
    },
    diagnosis: {
      status: "validated",
      schemaVersion: "podo.diagnosis.v1",
      summary: "The incident needs operator follow-up.",
      affectedService: "checkout-service",
      probableRootCause: "No safe automated remediation is available.",
      confidence: { value: 9100, scale: "basis_points" },
      evidenceIds: [evidence.id],
      recommendedAction: "Create an evidence-backed tracking issue.",
      safeToAttemptFix: false,
    },
  }
}

function reset() {
  incident = {
    id: "incident_live",
    status: "detected",
    detector: "cache_growth",
    affectedService: "checkout-service",
    deploymentId: "deploy-1042",
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt: now,
    evidence: [evidence],
  }
  remediation = null
  delivery = null
  buildIncident = {
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
      createdAt: now,
      updatedAt: now,
      url: "https://github.com/reseaxch/podo/actions/runs/1042",
    },
    evidence: [
      {
        id: "build-evidence-step",
        sourceId: "step:4",
        sourceType: "github_actions_step",
        observedAt: now,
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
    createdAt: now,
    updatedAt: now,
  }
}
reset()

function send(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4101")
  if (url.pathname === "/healthz")
    return send(response, {
      service: "podo-core",
      status: "ok",
      version: "test",
    })
  if (url.pathname === "/__reset" && request.method === "POST") {
    reset()
    return send(response, { ok: true })
  }
  if (url.pathname === "/api/incidents" && request.method === "GET")
    return send(response, { incidents: [incident] })
  if (url.pathname === "/api/build-incidents" && request.method === "GET")
    return send(response, { incidents: [buildIncident] })
  const buildMatch = url.pathname.match(/^\/api\/build-incidents\/([^/]+)$/)
  if (buildMatch?.[1] && request.method === "GET")
    return send(response, { incident: buildIncident })
  const buildAuditMatch = url.pathname.match(
    /^\/api\/build-incidents\/([^/]+)\/audit$/,
  )
  if (buildAuditMatch?.[1] && request.method === "GET")
    return send(response, {
      events: [
        {
          sequence: 1,
          occurredAt: now,
          incidentId: buildIncident.id,
          kind: "build.incident_created",
        },
      ],
    })
  const buildRetryMatch = url.pathname.match(
    /^\/api\/build-incidents\/([^/]+)\/retry$/,
  )
  if (buildRetryMatch?.[1] && request.method === "POST") {
    buildIncident = {
      ...buildIncident,
      status: "retry_pending_approval",
      retry: {
        id: "retry-1",
        status: "pending_approval",
        approval: { id: "approval-1", status: "pending" },
        sourceRun: {
          id: 1042,
          attempt: 1,
          headSha: buildIncident.sourceRun.headSha,
        },
        createdAt: now,
        updatedAt: now,
      },
    }
    return send(
      response,
      { incident: buildIncident, retry: buildIncident.retry },
      201,
    )
  }
  const buildRetryApprovalMatch = url.pathname.match(
    /^\/api\/build-incidents\/([^/]+)\/retry\/approvals\/([^/]+)$/,
  )
  if (buildRetryApprovalMatch?.[1] && request.method === "POST") {
    buildIncident = {
      ...buildIncident,
      status: "awaiting_ci_result",
      retry: {
        ...buildIncident.retry,
        status: "awaiting_ci_result",
        approval: { id: "approval-1", status: "approved" },
        updatedAt: now,
      },
    }
    return send(response, {
      incident: buildIncident,
      retry: buildIncident.retry,
    })
  }
  const unsafeIncidentMatch = url.pathname.match(
    /^\/api\/incidents\/(incident_unsafe_[^/]+)$/,
  )
  if (unsafeIncidentMatch?.[1] && request.method === "GET")
    return send(response, { incident: unsafeIncident(unsafeIncidentMatch[1]) })
  if (
    url.pathname === "/api/incidents/incident_live" &&
    request.method === "GET"
  )
    return send(response, { incident })
  if (
    /^\/api\/incidents\/[^/]+\/evidence$/.test(url.pathname) &&
    request.method === "GET"
  )
    return send(response, { records: [evidenceRecord] })
  if (
    url.pathname === "/api/incidents/incident_live/investigation" &&
    request.method === "POST"
  ) {
    incident = {
      ...incident,
      investigation: {
        id: "investigation_live",
        status: "completed",
        startedAt: now,
        updatedAt: now,
      },
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "Heap growth is caused by retained cache entries.",
        affectedService: "checkout-service",
        probableRootCause: "CheckoutCache retains entries without a bound.",
        confidence: { value: 9200, scale: "basis_points" },
        evidenceIds: [evidence.id],
        recommendedAction: "Prepare a bounded cache remediation.",
        safeToAttemptFix: true,
      },
    }
    return send(
      response,
      { incident, investigation: incident.investigation },
      201,
    )
  }
  if (url.pathname === "/api/incidents/incident_live/remediation") {
    if (request.method === "GET")
      return remediation
        ? send(response, { remediation })
        : send(response, { error: "not_found" }, 404)
    remediation = {
      id: "remediation_live",
      incidentId: incident.id,
      status: "pending_approval",
      target: "isolated_checkout",
      approval: { id: "approval_remediation", status: "pending" },
      createdAt: now,
      updatedAt: now,
    }
    return send(response, { remediation }, 201)
  }
  if (
    url.pathname ===
      "/api/incidents/incident_live/remediation/approvals/approval_remediation" &&
    request.method === "POST"
  ) {
    remediation = {
      ...remediation,
      status: "completed",
      approval: { id: "approval_remediation", status: "approved" },
      artifact: {
        provenance: {
          baseRef: "main",
          baseCommit: "abc123",
          resultTreeOid: "tree123",
        },
        evidenceIds: [evidence.id],
        patch: {
          summary: "Bound cache",
          changedFiles: ["cache.ts"],
          unifiedDiff: "+limit",
          sha256: "hash",
        },
        regression: {
          test: "cache.test.ts",
          prePatch: "failed",
          postPatch: "passed",
        },
        validation: { status: "passed", checks: ["unit"] },
        pullRequestPreview: {
          id: "artifact_live",
          title: "Bound cache",
          body: "Verified",
          baseBranch: "main",
          headBranch: "fix/cache",
        },
      },
    }
    return send(response, { remediation })
  }
  if (url.pathname === "/api/incidents/incident_live/remediation/delivery") {
    if (request.method === "GET")
      return delivery
        ? send(response, { delivery })
        : send(response, { error: "not_found" }, 404)
    delivery = {
      id: "delivery_live",
      incidentId: incident.id,
      remediationId: remediation.id,
      artifactId: "artifact_live",
      status: "pending_approval",
      approval: { id: "approval_delivery", status: "pending" },
      createdAt: now,
      updatedAt: now,
    }
    return send(response, { delivery }, 201)
  }
  const unsafeIssueMatch = url.pathname.match(
    /^\/api\/incidents\/(incident_unsafe_[^/]+)\/issue$/,
  )
  if (unsafeIssueMatch?.[1]) {
    const incidentId = unsafeIssueMatch[1]
    const existing = unsafeIssues.get(incidentId)
    if (request.method === "GET")
      return existing
        ? send(response, { issueDelivery: existing })
        : send(response, { error: "not_found" }, 404)
    const issueDelivery = {
      id: `issue_delivery_${incidentId}`,
      incidentId,
      reason: "remediation_not_safe",
      status: "created",
      createdAt: now,
      updatedAt: now,
      issue: {
        provider: "github",
        repository: "reseaxch/podo",
        number: 91,
        url: "https://github.com/reseaxch/podo/issues/91",
        state: "open",
        providerStatus: "created",
        draftId: "issue_draft_live",
        idempotencyKey: `issue_delivery_${incidentId}`,
        contentSha256: "abc123",
      },
    }
    unsafeIssues.set(incidentId, issueDelivery)
    return send(response, { issueDelivery }, 201)
  }
  if (
    url.pathname ===
      "/api/incidents/incident_live/remediation/delivery/approvals/approval_delivery" &&
    request.method === "POST"
  ) {
    delivery = {
      ...delivery,
      status: "delivered",
      approval: { id: "approval_delivery", status: "approved" },
      pullRequest: {
        provider: "github",
        repository: "reseaxch/podo",
        number: 1842,
        url: "https://github.com/reseaxch/podo/pull/1842",
        baseCommit: "abc123",
        baseBranch: "main",
        headBranch: "fix/cache",
        artifactId: "artifact_live",
      },
    }
    return send(response, { delivery })
  }
  return send(response, { error: "not_found" }, 404)
}).listen(port, "127.0.0.1")
