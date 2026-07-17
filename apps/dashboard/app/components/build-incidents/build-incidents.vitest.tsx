import type { BuildIncident } from "@podo/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { BuildIncidentsOverview } from "./build-incidents-overview"
import {
  BuildIncidentWorkspace,
  type BuildIncidentWorkspaceController,
} from "./build-incident-workspace"

vi.mock("next/navigation", () => ({ usePathname: () => "/build-incidents" }))

const incident: BuildIncident = {
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
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:05:00.000Z",
    url: "https://github.com/reseaxch/podo/actions/runs/1042",
  },
  evidence: [],
  createdAt: "2026-07-16T10:05:00.000Z",
  updatedAt: "2026-07-16T10:06:00.000Z",
}

describe("BuildIncidentsOverview", () => {
  it("uses the shared showcase chrome in demo mode", () => {
    render(
      <BuildIncidentsOverview
        incidents={[incident]}
        shell={{
          owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
          source: "demo",
        }}
      />,
    )

    expect(screen.getByRole("button", { name: /podo-cloud/i })).toBeVisible()
    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible()
    expect(
      screen.getByText("Incidents", { selector: ".breadcrumbs span" }),
    ).toBeVisible()
    expect(screen.getByRole("img", { name: "Maya Chen" })).toBeVisible()
  })

  it("exposes Core build failures as navigable production records", () => {
    render(<BuildIncidentsOverview incidents={[incident]} />)

    expect(
      screen.getByRole("heading", { name: "Build incidents" }),
    ).toBeVisible()
    expect(screen.getByText("reseaxch/podo")).toBeVisible()
    expect(screen.getByText("Awaiting action")).toBeVisible()
    expect(
      screen.getByRole("link", { name: /Open build incident/ }),
    ).toHaveAttribute(
      "href",
      `/build-incidents/${encodeURIComponent(incident.id)}`,
    )
    expect(screen.getByText("reseaxch/podo").closest("a")).toHaveAttribute(
      "href",
      `/build-incidents/${encodeURIComponent(incident.id)}`,
    )
    expect(
      screen.getByRole("region", {
        name: "Build incident operational summary",
      }),
    ).toHaveTextContent("Needs action1")
    expect(
      screen.getByRole("heading", { name: "GitHub Actions incidents" }),
    ).toBeVisible()
  })

  it("filters the operational queue by workflow state", async () => {
    const user = userEvent.setup()
    const verified: BuildIncident = {
      ...incident,
      id: "build:reseaxch/podo:1043:1",
      status: "verified",
      repository: "reseaxch/verified-service",
    }
    render(<BuildIncidentsOverview incidents={[incident, verified]} />)

    await user.click(screen.getByRole("tab", { name: "Needs action (1)" }))

    expect(screen.getByText("reseaxch/podo")).toBeVisible()
    expect(
      screen.queryByText("reseaxch/verified-service"),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "In progress (0)" }))
    expect(screen.getByText("No build incidents in this view")).toBeVisible()
    expect(screen.getByRole("tab", { name: "All builds (2)" })).toBeVisible()

    await user.click(screen.getByRole("tab", { name: "All builds (2)" }))
    expect(screen.getByText("reseaxch/podo")).toBeVisible()
    expect(screen.getByText("reseaxch/verified-service")).toBeVisible()
  })

  it("explains when GitHub Actions has no captured failures", () => {
    render(<BuildIncidentsOverview incidents={[]} />)

    expect(
      screen.getByRole("heading", { name: "No build incidents" }),
    ).toBeVisible()
    expect(
      screen.getByText(/GitHub Actions failures captured by Core/),
    ).toBeVisible()
  })
})

describe("BuildIncidentWorkspace", () => {
  it("uses the shared showcase chrome in demo mode", () => {
    render(
      <BuildIncidentWorkspace
        initial={{ incident, events: [] }}
        shell={{
          owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
          source: "demo",
        }}
      />,
    )

    expect(screen.getByRole("button", { name: /podo-cloud/i })).toBeVisible()
    expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible()
    expect(
      screen.getByText("Incidents", { selector: ".breadcrumbs span" }),
    ).toBeVisible()
    expect(screen.getByRole("img", { name: "Maya Chen" })).toBeVisible()
  })

  it("requests only the exact failed workflow run retry", async () => {
    const user = userEvent.setup()
    const readyIncident: BuildIncident = {
      ...incident,
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "The dashboard typecheck failed after the latest commit.",
        affectedService: "dashboard",
        probableRootCause: "A route imports a missing component.",
        confidence: { value: 9100, scale: "basis_points" },
        evidenceIds: [],
        recommendedAction: "Retry the exact failed run once.",
        safeToAttemptFix: true,
      },
    }
    const controller: BuildIncidentWorkspaceController = {
      refresh: vi
        .fn()
        .mockResolvedValue({ incident: readyIncident, events: [] }),
      startRetry: vi.fn().mockResolvedValue({
        incident: { ...readyIncident, status: "retry_pending_approval" },
        events: [],
      }),
      decideRetry: vi.fn(),
      startRemediation: vi.fn(),
      decideRemediation: vi.fn(),
      startDelivery: vi.fn(),
      decideDelivery: vi.fn(),
      startVerification: vi.fn(),
    }

    render(
      <BuildIncidentWorkspace
        controller={controller}
        initial={{ incident: readyIncident, events: [] }}
        mutationsEnabled
      />,
    )
    expect(screen.getByLabelText("Live Core workspace")).toBeVisible()
    expect(
      screen.getByRole("region", { name: "Build incident summary" }),
    ).toHaveTextContent("91%")
    await user.click(
      screen.getByRole("button", { name: "Request exact retry" }),
    )

    expect(controller.startRetry).toHaveBeenCalledWith(readyIncident.id)
    expect(screen.getByText(/Run 1042 · attempt 1/)).toBeVisible()
  })

  it("requires an explicit decision for a pending retry approval", async () => {
    const user = userEvent.setup()
    const pendingIncident: BuildIncident = {
      ...incident,
      status: "retry_pending_approval",
      retry: {
        id: "retry-1",
        status: "pending_approval",
        approval: { id: "approval-1", status: "pending" },
        sourceRun: {
          id: 1042,
          attempt: 1,
          headSha: incident.sourceRun.headSha,
        },
        createdAt: incident.updatedAt,
        updatedAt: incident.updatedAt,
      },
    }
    const controller: BuildIncidentWorkspaceController = {
      refresh: vi.fn(),
      startRetry: vi.fn(),
      decideRetry: vi
        .fn()
        .mockResolvedValue({ incident: pendingIncident, events: [] }),
      startRemediation: vi.fn(),
      decideRemediation: vi.fn(),
      startDelivery: vi.fn(),
      decideDelivery: vi.fn(),
      startVerification: vi.fn(),
    }

    render(
      <BuildIncidentWorkspace
        controller={controller}
        initial={{ incident: pendingIncident, events: [] }}
        mutationsEnabled
      />,
    )
    expect(controller.decideRetry).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole("button", { name: "Approve exact retry" }),
    )
    expect(controller.decideRetry).toHaveBeenCalledWith(
      pendingIncident.id,
      "approval-1",
      "approve",
    )
  })

  it("keeps remediation and delivery behind their Core approvals", async () => {
    const user = userEvent.setup()
    const remediatingIncident: BuildIncident = {
      ...incident,
      status: "remediating",
    }
    const remediation = {
      id: "remediation-1",
      incidentId: incident.id,
      status: "pending_approval" as const,
      target: "isolated_checkout" as const,
      approval: { id: "remediation-approval-1", status: "pending" as const },
      createdAt: incident.updatedAt,
      updatedAt: incident.updatedAt,
    }
    const controller: BuildIncidentWorkspaceController = {
      refresh: vi.fn(),
      startRetry: vi.fn(),
      decideRetry: vi.fn(),
      startRemediation: vi.fn(),
      decideRemediation: vi.fn().mockResolvedValue({
        incident: remediatingIncident,
        remediation,
        delivery: null,
        events: [],
      }),
      startDelivery: vi.fn(),
      decideDelivery: vi.fn(),
      startVerification: vi.fn(),
    }

    render(
      <BuildIncidentWorkspace
        controller={controller}
        initial={{
          incident: remediatingIncident,
          remediation,
          delivery: null,
          events: [],
        }}
        mutationsEnabled
      />,
    )
    expect(
      screen.queryByRole("button", { name: "Verify delivered remediation" }),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Approve tested remediation" }),
    )
    expect(controller.decideRemediation).toHaveBeenCalledWith(
      incident.id,
      "remediation-approval-1",
      "approve",
    )
  })

  it("keeps the runtime workspace read-only without an operator boundary", () => {
    render(
      <BuildIncidentWorkspace
        initial={{ incident, events: [] }}
        shell={{
          owner: { name: "Podo Core", avatar: "/icon.svg" },
          source: "core",
        }}
      />,
    )

    expect(screen.getByText("Read-only workspace")).toBeVisible()
    expect(
      screen.getByText(/authenticated operator access is implemented/),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Request exact retry" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Refresh Core state" }),
    ).toBeVisible()
  })
})
