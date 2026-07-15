import type { DetectedIncident } from "@podo/contracts"
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

function withIncident(overrides: Partial<DetectedIncident>): DetectedIncident {
  return { ...incident, ...overrides }
}

describe("ProductionIncidentWorkspace", () => {
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
