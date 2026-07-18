import type {
  DetectedIncident,
  IncidentCausalPath,
  IncidentEvidenceRecord,
} from "@podo/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { toCoreIncidentWorkspace } from "../lib/incident-data"
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
      id: "evidence_trace",
      sourceEventId: "event_trace",
      sourceType: "trace",
      observedAt: "2026-07-14T10:06:00.000Z",
      service: "checkout-service",
      deploymentId: "deploy-1042",
    },
  ],
}

const records: IncidentEvidenceRecord[] = [
  {
    evidence: incident.evidence[0]!,
    event: {
      id: "event_metric",
      timestamp: "2026-07-14T10:05:00.000Z",
      kind: "metric",
      service: "checkout-service",
      severity: "warn",
      message: "process heap sample",
      deploymentId: "deploy-1042",
      containerId: "checkout-container",
      metric: {
        name: "process.heap.used",
        value: 620 * 1024 * 1024,
        unit: "By",
      },
    },
  },
  {
    evidence: incident.evidence[1]!,
    event: {
      id: "event_trace",
      timestamp: "2026-07-14T10:06:00.000Z",
      kind: "trace",
      service: "checkout-service",
      severity: "error",
      message: "POST /checkout returned 500",
      deploymentId: "deploy-1042",
      containerId: "checkout-container",
      traceId: "trace-live",
    },
  },
]

const causalPath: IncidentCausalPath = {
  schemaVersion: "podo.causal-path.v1",
  id: "path-live",
  incident: { id: incident.id },
  evidence: { id: "evidence_metric" },
  telemetryEvent: {
    id: "event_metric",
    occurredAt: "2026-07-14T10:05:00.000Z",
  },
  container: { id: "checkout-container" },
  deployment: { id: "deploy-1042" },
  commit: { id: "commit-live", sha: "d34db33f" },
  file: {
    id: "file-live",
    kind: "file",
    externalId: "file:cache",
    label: "cache.ts",
    location: { path: "services/checkout/cache.ts", line: 1 },
  },
  function: {
    id: "function-live",
    kind: "function",
    externalId: "function:cache",
    label: "CheckoutCache.set",
    location: { path: "services/checkout/cache.ts", line: 47 },
  },
}

function workspace(currentIncident = incident) {
  return toCoreIncidentWorkspace({
    incident: currentIncident,
    records,
    causalPath,
    remediation: null,
    delivery: null,
    issueDelivery: null,
  })
}

describe("ProductionIncidentWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        disconnect() {}
      },
    )
  })

  it("renders the rich workspace exclusively from Core data", () => {
    render(<ProductionIncidentWorkspace workspace={workspace()} />)

    expect(
      screen.getByRole("heading", {
        name: "Cache growth in checkout-service after deploy-1042",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /process heap sample/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/620 MiB/)).toBeInTheDocument()
    expect(screen.getAllByText("Podo Core").length).toBeGreaterThan(0)
    expect(screen.queryByText("Maya Chen")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Unbounded cache key retention"),
    ).not.toBeInTheDocument()
  })

  it("projects validated diagnosis and trusted causal path into the rich UI", async () => {
    const user = userEvent.setup()
    const diagnosed: DetectedIncident = {
      ...incident,
      investigation: {
        id: "investigation-live",
        status: "completed",
        startedAt: "2026-07-14T10:10:00.000Z",
        updatedAt: "2026-07-14T10:12:00.000Z",
      },
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "Heap growth correlates with checkout failures",
        affectedService: "checkout-service",
        probableRootCause: "The deployed cache retains entries without a bound",
        confidence: { value: 8750, scale: "basis_points" },
        evidenceIds: ["evidence_metric", "evidence_trace"],
        recommendedAction: "Bound the cache and add a regression",
        safeToAttemptFix: true,
      },
    }
    render(<ProductionIncidentWorkspace workspace={workspace(diagnosed)} />)

    expect(
      screen.getByText("The deployed cache retains entries without a bound"),
    ).toBeInTheDocument()
    expect(screen.getByText("87%")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Graph" }))
    expect(
      screen.getByRole("heading", { name: "Evidence to affected code" }),
    ).toBeInTheDocument()
    expect(screen.getByText("CheckoutCache.set")).toBeInTheDocument()
    expect(screen.getByText("services/checkout/cache.ts")).toBeInTheDocument()
  })

  it("routes workflow actions through Core and refreshes the workspace", async () => {
    const user = userEvent.setup()
    const refreshed = workspace()
    refreshed.status = "Monitoring"
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ accepted: true }))
      .mockResolvedValueOnce(Response.json({ workspace: refreshed }))
    vi.stubGlobal("fetch", fetchMock)
    render(
      <ProductionIncidentWorkspace
        initialTab="changes"
        workspace={workspace()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "Investigate incident" }),
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/podo/incidents/incident_live",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "start-investigation" }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/podo/incidents/incident_live",
      { cache: "no-store" },
    )
    expect(await screen.findByText("Monitoring")).toBeInTheDocument()
  })

  it("refreshes evidence through the Core incident endpoint", async () => {
    const user = userEvent.setup()
    const refreshed = workspace()
    refreshed.evidence[0] = {
      ...refreshed.evidence[0]!,
      finding: "fresh process heap sample",
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ workspace: refreshed }))
    vi.stubGlobal("fetch", fetchMock)
    render(<ProductionIncidentWorkspace workspace={workspace()} />)

    await user.click(
      screen.getByRole("button", { name: "Load newer evidence" }),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/podo/incidents/incident_live",
      { cache: "no-store" },
    )
    expect(
      await screen.findByRole("button", {
        name: /fresh process heap sample/i,
      }),
    ).toBeInTheDocument()
  })

  it("renders a newly selected incident without retaining client state", () => {
    const first = workspace()
    const second = {
      ...workspace(),
      id: "incident_second",
      title: "Cache growth in payments-service after deploy-2048",
      service: "payments-service",
    }
    const { rerender } = render(
      <ProductionIncidentWorkspace workspace={first} />,
    )

    rerender(<ProductionIncidentWorkspace workspace={second} />)

    expect(
      screen.getByRole("heading", {
        name: "Cache growth in payments-service after deploy-2048",
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: first.title }),
    ).not.toBeInTheDocument()
  })
})
