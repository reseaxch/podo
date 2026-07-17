"use client"

import type { BuildIncident, BuildIncidentStatus } from "@podo/contracts"
import Link from "next/link"
import { useMemo, useState } from "react"

import { useToast } from "../../hooks/use-toast"
import type { DashboardShellContext } from "../../lib/dashboard-shell"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { AnimatedNumber } from "../ui/animated-number"
import { Icon } from "../ui/pictogram"

const statusLabels: Record<BuildIncidentStatus, string> = {
  investigating: "Investigating",
  awaiting_action: "Awaiting action",
  retry_pending_approval: "Retry approval",
  retrying: "Retrying",
  awaiting_ci_result: "Awaiting CI",
  remediating: "Remediating",
  verified: "Verified",
  denied: "Denied",
  failed: "Failed",
}

type BuildQueueView = "all" | "attention" | "active" | "verified"

const queueViews: Array<{ id: BuildQueueView; label: string }> = [
  { id: "all", label: "All builds" },
  { id: "attention", label: "Needs action" },
  { id: "active", label: "In progress" },
  { id: "verified", label: "Verified" },
]

function matchesView(incident: BuildIncident, view: BuildQueueView) {
  if (view === "all") return true
  if (view === "attention")
    return ["awaiting_action", "retry_pending_approval"].includes(
      incident.status,
    )
  if (view === "active")
    return [
      "investigating",
      "retrying",
      "awaiting_ci_result",
      "remediating",
    ].includes(incident.status)
  return incident.status === "verified"
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))
}

const coreShell: DashboardShellContext = {
  owner: { name: "Podo Core", avatar: "/icon.svg" },
  source: "core",
}

export function BuildIncidentsOverview({
  incidents,
  shell = coreShell,
}: {
  incidents: BuildIncident[]
  shell?: DashboardShellContext
}) {
  const [query, setQuery] = useState("")
  const [view, setView] = useState<BuildQueueView>("all")
  const { toast, toastState, showToast } = useToast()
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return incidents.filter(
      (incident) =>
        matchesView(incident, view) &&
        (!normalized ||
          `${incident.id} ${incident.repository} ${incident.workflow.name} ${incident.affectedService} ${statusLabels[incident.status]}`
            .toLowerCase()
            .includes(normalized)),
    )
  }, [incidents, query, view])
  const summary = useMemo(
    () => ({
      attention: incidents.filter((incident) =>
        matchesView(incident, "attention"),
      ).length,
      active: incidents.filter((incident) => matchesView(incident, "active"))
        .length,
      verified: incidents.filter((incident) =>
        matchesView(incident, "verified"),
      ).length,
      evidence: incidents.reduce(
        (total, incident) => total + incident.evidence.length,
        0,
      ),
    }),
    [incidents],
  )

  return (
    <main className="app-shell build-incidents-shell" data-ready="true">
      <IconRail />
      <Topbar
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={shell.owner}
        query={query}
        searchLabel="Search build incidents"
        searchPlaceholder="Search builds, repositories, workflows..."
        section="Incidents"
        source={shell.source}
        current="Build incidents"
      />
      <section className="build-incidents-page">
        <header className="build-incidents-heading">
          <div>
            <span className="eyebrow">GitHub Actions</span>
            <h1>Build incidents</h1>
            <p>
              Investigate failed workflow runs, approve an exact retry, or
              verify a tested remediation.
            </p>
          </div>
          <span className="build-source-badge">
            <i /> Core-owned records
          </span>
        </header>

        <section
          aria-label="Build incident operational summary"
          className="build-operations-summary"
        >
          <div data-tone={summary.attention ? "warning" : "neutral"}>
            <span>Needs action</span>
            <strong>
              <AnimatedNumber value={summary.attention} />
            </strong>
            <small>approval or operator decision</small>
          </div>
          <div>
            <span>In progress</span>
            <strong>
              <AnimatedNumber value={summary.active} />
            </strong>
            <small>Core-owned workflows</small>
          </div>
          <div data-tone="verified">
            <span>Verified</span>
            <strong>
              <AnimatedNumber value={summary.verified} />
            </strong>
            <small>exact CI results</small>
          </div>
          <div>
            <span>Evidence</span>
            <strong>
              <AnimatedNumber value={summary.evidence} />
            </strong>
            <small>workflow, job, and step records</small>
          </div>
        </section>

        {incidents.length === 0 ? (
          <section className="build-empty-state">
            <Icon name="check-circle" size={26} />
            <h2>No build incidents</h2>
            <p>
              GitHub Actions failures captured by Core will appear here. No demo
              fixtures are substituted.
            </p>
          </section>
        ) : (
          <section className="build-queue" aria-label="Build incidents">
            <header className="build-queue-header">
              <div>
                <span className="eyebrow">Failure queue</span>
                <h2>GitHub Actions incidents</h2>
                <p>{visible.length} records in the current view</p>
              </div>
              <div
                aria-label="Build incident status"
                className="build-filters"
                role="tablist"
              >
                {queueViews.map((item) => {
                  const count = incidents.filter((incident) =>
                    matchesView(incident, item.id),
                  ).length
                  return (
                    <button
                      aria-controls="build-incident-results"
                      aria-label={`${item.label} (${count})`}
                      aria-selected={view === item.id}
                      id={`build-view-${item.id}`}
                      key={item.id}
                      onClick={() => setView(item.id)}
                      role="tab"
                      type="button"
                    >
                      {item.label}
                      <span>{count}</span>
                    </button>
                  )
                })}
              </div>
            </header>
            <div
              aria-labelledby={`build-view-${view}`}
              className="build-incident-grid"
              id="build-incident-results"
              role="tabpanel"
            >
              {visible.length ? (
                visible.map((incident) => (
                  <Link
                    aria-label={`Open build incident ${incident.id}`}
                    className="build-incident-card motion-list-item"
                    href={`/build-incidents/${encodeURIComponent(incident.id)}`}
                    key={incident.id}
                  >
                    <div className="build-card-primary">
                      <header>
                        <span
                          className={`build-status build-status-${incident.status}`}
                        >
                          {statusLabels[incident.status]}
                        </span>
                        <time dateTime={incident.updatedAt}>
                          Updated {formatInstant(incident.updatedAt)} UTC
                        </time>
                      </header>
                      <div className="build-incident-title">
                        <span className="build-provider-icon">
                          <Icon name="github" size={18} />
                        </span>
                        <div>
                          <strong>{incident.repository}</strong>
                          <span>
                            {incident.workflow.name} · run #
                            {incident.sourceRun.runNumber} · attempt{" "}
                            {incident.sourceRun.attempt}
                          </span>
                        </div>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>Service</dt>
                        <dd>{incident.affectedService}</dd>
                      </div>
                      <div>
                        <dt>Failed commit</dt>
                        <dd>
                          <code>{incident.sourceRun.headSha.slice(0, 12)}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Evidence</dt>
                        <dd>{incident.evidence.length} records</dd>
                      </div>
                    </dl>
                    <span className="build-review-affordance">
                      Review incident <Icon name="caret-right" size={14} />
                    </span>
                  </Link>
                ))
              ) : (
                <div className="build-filter-empty" role="status">
                  <Icon name="magnifying-glass" size={20} />
                  <span>
                    <strong>No build incidents in this view</strong>
                    <small>
                      Choose another status above
                      {query ? " or update the search query" : ""}.
                    </small>
                  </span>
                </div>
              )}
            </div>
          </section>
        )}
      </section>
      {toast ? (
        <div className="toast" data-motion-state={toastState} role="status">
          {toast}
        </div>
      ) : null}
    </main>
  )
}
