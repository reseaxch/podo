import type {
  DetectedIncident,
  IncidentDelivery,
  IncidentCausalPath,
  IncidentIssueDelivery,
  IncidentRemediation,
} from "@podo/contracts"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProductionIncidentWorkspace } from "./production-incident-workspace"

const incident: DetectedIncident = {
  id: "incident_live",
  status: "detected",
  detector: "cache_growth",
  affectedService: "checkout-service",
  deploymentId: "deploy-1042",
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:15:00.000Z",
  evidence: [
    {
      id: "evidence_metric",
      sourceEventId: "event_metric",
      sourceType: "metric",
      observedAt: "2026-07-14T10:05:00.000Z",
      service: "checkout-service",
      deploymentId: "deploy-1042",
    },
    {
      id: "evidence_log",
      sourceEventId: "event_log",
      sourceType: "log",
      observedAt: "2026-07-14T10:06:00.000Z",
      service: "checkout-service",
      deploymentId: "deploy-1042",
    },
  ],
}

const causalPath: IncidentCausalPath = {
  schemaVersion: "podo.causal-path.v1",
  id: "path-live",
  incident: { id: incident.id },
  evidence: { id: incident.evidence[0]!.id },
  telemetryEvent: {
    id: incident.evidence[0]!.sourceEventId,
    occurredAt: incident.evidence[0]!.observedAt,
  },
  container: { id: "checkout-service-7b9c" },
  deployment: { id: "deploy-1042" },
  commit: { id: "commit-live", sha: "d34db33f" },
  file: {
    id: "file-live",
    kind: "file",
    externalId: "file:cache",
    label: "cache.ts",
  },
  function: {
    id: "function-live",
    kind: "function",
    externalId: "function:cache",
    label: "CheckoutCache",
  },
}

function withIncident(overrides: Partial<DetectedIncident>): DetectedIncident {
  return { ...incident, ...overrides }
}

describe("ProductionIncidentWorkspace", () => {
  it("renders the Core-owned evidence-to-code causal path", () => {
    render(
      <ProductionIncidentWorkspace
        incident={incident}
        causalPath={causalPath}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Evidence to code" }),
    ).toBeInTheDocument()
    expect(screen.getByText("cache.ts")).toBeInTheDocument()
    expect(screen.getByText("CheckoutCache")).toBeInTheDocument()
  })

  it("renders only core-backed detection and evidence state", () => {
    render(<ProductionIncidentWorkspace incident={incident} />)

    expect(
      screen.getByRole("heading", {
        name: "Cache growth detected in checkout-service",
      }),
    ).toBeInTheDocument()
    expect(screen.getByText("event_metric")).toBeInTheDocument()
    expect(screen.getAllByText("deploy-1042")).toHaveLength(3)
    expect(
      screen.getByRole("heading", { name: "Investigation not started" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/87% confidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText("P1")).not.toBeInTheDocument()
  })

  it.each([
    ["starting", "Investigation starting"],
    ["running", "Investigation running"],
    ["waiting_for_approval", "Investigation waiting for approval"],
  ] as const)("renders the authoritative %s lifecycle", (status, heading) => {
    render(
      <ProductionIncidentWorkspace
        incident={withIncident({
          investigation: {
            id: "investigation_live",
            status,
            startedAt: "2026-07-14T10:16:00.000Z",
            updatedAt: "2026-07-14T10:17:00.000Z",
          },
        })}
      />,
    )

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    expect(screen.queryByText(/probable root cause/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /prepare tested remediation/i }),
    ).not.toBeInTheDocument()
  })

  it("renders a validated diagnosis and links only its core evidence", () => {
    render(
      <ProductionIncidentWorkspace
        incident={withIncident({
          investigation: {
            id: "investigation_live",
            status: "completed",
            startedAt: "2026-07-14T10:16:00.000Z",
            updatedAt: "2026-07-14T10:18:00.000Z",
          },
          diagnosis: {
            status: "validated",
            schemaVersion: "podo.diagnosis.v1",
            summary: "Heap growth correlates with checkout failures",
            affectedService: "checkout-service",
            probableRootCause:
              "The deployed cache retains entries without a bound",
            confidence: { value: 8750, scale: "basis_points" },
            evidenceIds: ["evidence_metric"],
            recommendedAction: "Inspect the cache retention policy",
            safeToAttemptFix: true,
          },
        })}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Evidence-backed diagnosis" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("The deployed cache retains entries without a bound"),
    ).toBeInTheDocument()
    expect(screen.getByText("87.50% confidence")).toBeInTheDocument()
    expect(
      screen.getByText("Inspect the cache retention policy"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "evidence_metric" }),
    ).toHaveAttribute("href", "#evidence-evidence_metric")
    expect(
      screen.queryByRole("link", { name: "evidence_log" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Prepare tested remediation" }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/safe to attempt/i)).not.toBeInTheDocument()
  })

  it("renders a failed diagnosis without remediation affordances", () => {
    render(
      <ProductionIncidentWorkspace
        incident={withIncident({
          investigation: {
            id: "investigation_live",
            status: "completed",
            startedAt: "2026-07-14T10:16:00.000Z",
            updatedAt: "2026-07-14T10:18:00.000Z",
          },
          diagnosis: {
            status: "failed",
            error: {
              code: "invalid_output",
              message:
                "Codex output did not satisfy the Podo diagnosis contract",
            },
          },
        })}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Diagnosis unavailable" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Codex output did not satisfy the Podo diagnosis contract",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/recommended action/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /prepare tested remediation/i }),
    ).not.toBeInTheDocument()
  })

  it("fails closed when validated diagnosis cites evidence absent from the incident", () => {
    render(
      <ProductionIncidentWorkspace
        incident={withIncident({
          investigation: {
            id: "investigation_live",
            status: "completed",
            startedAt: "2026-07-14T10:16:00.000Z",
            updatedAt: "2026-07-14T10:18:00.000Z",
          },
          diagnosis: {
            status: "validated",
            schemaVersion: "podo.diagnosis.v1",
            summary: "Untrusted diagnosis",
            affectedService: "checkout-service",
            probableRootCause: "Must not render",
            confidence: { value: 9999, scale: "basis_points" },
            evidenceIds: ["evidence_missing"],
            recommendedAction: "Must not render",
            safeToAttemptFix: true,
          },
        })}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Diagnosis unavailable" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/lifecycle response is incomplete/i),
    ).toBeInTheDocument()
    expect(screen.queryByText("Must not render")).not.toBeInTheDocument()
    expect(screen.queryByText("99.99% confidence")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /prepare tested remediation/i }),
    ).not.toBeInTheDocument()
  })

  it("fails closed when a completed investigation has no diagnosis state", () => {
    render(
      <ProductionIncidentWorkspace
        incident={withIncident({
          investigation: {
            id: "investigation_live",
            status: "completed",
            startedAt: "2026-07-14T10:16:00.000Z",
            updatedAt: "2026-07-14T10:18:00.000Z",
          },
        })}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Diagnosis unavailable" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /prepare tested remediation/i }),
    ).not.toBeInTheDocument()
  })

  it("opens the authoritative delivered pull request URL", () => {
    const delivery: IncidentDelivery = {
      id: "delivery_live",
      incidentId: incident.id,
      remediationId: "remediation_live",
      artifactId: "artifact_live",
      status: "delivered",
      approval: { id: "approval_delivery", status: "approved" },
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      pullRequest: {
        provider: "github",
        repository: "reseaxch/podo",
        number: 1842,
        url: "https://github.com/reseaxch/podo/pull/1842",
        baseCommit: "abc123",
        baseBranch: "main",
        headBranch: "fix/incident-live",
        artifactId: "artifact_live",
      },
    }
    render(
      <ProductionIncidentWorkspace incident={incident} delivery={delivery} />,
    )

    expect(screen.getByRole("link", { name: "Open PR #1842" })).toHaveAttribute(
      "href",
      delivery.pullRequest?.url,
    )
  })

  it("routes remediation failure through the Core-owned issue fallback", () => {
    const remediation: IncidentRemediation = {
      id: "remediation_live",
      incidentId: incident.id,
      status: "failed",
      target: "isolated_checkout",
      approval: { id: "approval_live", status: "approved" },
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      error: {
        code: "verification_failed",
        message: "Regression verification failed",
      },
    }
    render(
      <ProductionIncidentWorkspace
        incident={incident}
        remediation={remediation}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Create GitHub issue" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /issue/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /create pr/i }),
    ).not.toBeInTheDocument()
  })

  it("opens only the exact issue URL returned by Core", () => {
    const issueDelivery: IncidentIssueDelivery = {
      id: "issue_delivery_live",
      incidentId: incident.id,
      reason: "remediation_failed",
      status: "created",
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      issue: {
        provider: "github",
        repository: "reseaxch/podo",
        number: 91,
        url: "https://github.com/reseaxch/podo/issues/91",
        state: "open",
        providerStatus: "created",
        draftId: "issue_draft_live",
        idempotencyKey: "issue_delivery_live",
        contentSha256: "abc123",
      },
    }

    render(
      <ProductionIncidentWorkspace
        incident={incident}
        issueDelivery={issueDelivery}
      />,
    )

    expect(
      screen.getByRole("link", { name: "Open issue #91" }),
    ).toHaveAttribute("href", issueDelivery.issue?.url)
  })
})
