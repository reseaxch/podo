import type { DetectedIncident } from "@rootline/contracts"
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
  ],
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
    expect(screen.getAllByText("deploy-1042")).toHaveLength(2)
    expect(
      screen.getByRole("heading", { name: "Investigation not started" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/87% confidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText("P1")).not.toBeInTheDocument()
  })
})
