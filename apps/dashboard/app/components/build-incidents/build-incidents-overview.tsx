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

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

const coreShell: DashboardShellContext = {
  owner: { name: "Podo Core", avatar: "/brand/podo-logo.png" },
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
  const availableQueueViews = useMemo(
    () =>
      queueViews.filter((item) => {
        if (item.id === "all") return true
        const count = incidents.filter((incident) =>
          matchesView(incident, item.id),
        ).length
        return count > 0 && count < incidents.length
      }),
    [incidents],
  )
  const showQueueFilters = availableQueueViews.length > 1
  const priorityIncident = useMemo(
    () =>
      incidents.find((incident) => matchesView(incident, "attention")) ??
      incidents[0],
    [incidents],
  )
  const priorityFailure = priorityIncident?.evidence.find(
    (evidence) => evidence.sourceType === "github_actions_step",
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
            <div className="build-heading-meta">
              <span className="eyebrow">GitHub Actions</span>
              <span className="build-source-badge">
                <i /> Core-owned records
              </span>
            </div>
            <h1>Build incidents</h1>
            <p>
              Investigate failed workflow runs, approve an exact retry, or
              verify a tested remediation.
            </p>
          </div>
        </header>

        <section
          aria-label="Build incident operational summary"
          className="build-operations-summary"
        >
          <div
            data-empty={summary.attention === 0 || undefined}
            data-tone={summary.attention ? "warning" : "neutral"}
          >
            <span>Needs action</span>
            <strong>
              <AnimatedNumber value={summary.attention} />
            </strong>
            <small>approval or operator decision</small>
          </div>
          <div data-empty={summary.active === 0 || undefined}>
            <span>In progress</span>
            <strong>
              <AnimatedNumber value={summary.active} />
            </strong>
            <small>Core-owned workflows</small>
          </div>
          <div
            data-empty={summary.verified === 0 || undefined}
            data-tone="verified"
          >
            <span>Verified</span>
            <strong>
              <AnimatedNumber value={summary.verified} />
            </strong>
            <small>exact CI results</small>
          </div>
          <div data-empty={summary.evidence === 0 || undefined}>
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
          <div className="build-workspace">
            <section className="build-queue" aria-label="Build incidents">
              <header className="build-queue-header">
                <div>
                  <span className="eyebrow">Failure queue</span>
                  <h2>GitHub Actions incidents</h2>
                  <p>
                    {formatCount(visible.length, "record")} in the current view
                  </p>
                </div>
                {showQueueFilters ? (
                  <div
                    aria-label="Build incident status"
                    className="build-filters"
                    role="tablist"
                  >
                    {availableQueueViews.map((item) => {
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
                ) : null}
              </header>
              <div
                aria-label={
                  showQueueFilters ? undefined : "Build incident results"
                }
                aria-labelledby={
                  showQueueFilters ? `build-view-${view}` : undefined
                }
                className="build-incident-grid"
                id="build-incident-results"
                role={showQueueFilters ? "tabpanel" : "region"}
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
                        <p className="build-card-guidance">
                          {(incident.diagnosis?.status === "validated"
                            ? incident.diagnosis.recommendedAction
                            : undefined) ??
                            "Review the captured failure evidence and choose the next safe action."}
                        </p>
                      </div>
                      <dl>
                        <div>
                          <dt>Service</dt>
                          <dd>{incident.affectedService}</dd>
                        </div>
                        <div>
                          <dt>Failed commit</dt>
                          <dd>
                            <code>
                              {incident.sourceRun.headSha.slice(0, 12)}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt>Evidence</dt>
                          <dd>
                            {formatCount(incident.evidence.length, "record")}
                          </dd>
                        </div>
                      </dl>
                      <span className="build-review-affordance">
                        Open <Icon name="caret-right" size={14} />
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
            {priorityIncident ? (
              <aside
                aria-labelledby="build-action-summary-title"
                className="build-action-summary"
              >
                <header>
                  <span className="eyebrow">Next safe step</span>
                  <h2 id="build-action-summary-title">Action summary</h2>
                </header>
                <span
                  className={`build-status build-status-${priorityIncident.status}`}
                >
                  {statusLabels[priorityIncident.status]}
                </span>
                {priorityIncident.diagnosis?.status === "validated" ? (
                  <div className="build-diagnosis-brief">
                    <span>Probable root cause</span>
                    <strong>
                      {priorityIncident.diagnosis.probableRootCause}
                    </strong>
                    <small>{priorityIncident.diagnosis.summary}</small>
                  </div>
                ) : null}
                {priorityFailure ? (
                  <div className="build-failed-step">
                    <span>Failed step</span>
                    <strong>{priorityFailure.summary}</strong>
                  </div>
                ) : null}
                <div className="build-next-action">
                  <span>Recommended action</span>
                  <p>
                    {priorityIncident.diagnosis?.status === "validated"
                      ? priorityIncident.diagnosis.recommendedAction
                      : "Review the captured workflow evidence before choosing the next action."}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Workflow</dt>
                    <dd>{priorityIncident.workflow.name}</dd>
                  </div>
                  <div>
                    <dt>Run</dt>
                    <dd>#{priorityIncident.sourceRun.runNumber}</dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>
                      {formatCount(priorityIncident.evidence.length, "record")}
                    </dd>
                  </div>
                </dl>
                <Link
                  className="build-summary-action"
                  href={`/build-incidents/${encodeURIComponent(priorityIncident.id)}`}
                >
                  Review incident <Icon name="caret-right" size={14} />
                </Link>
              </aside>
            ) : null}
          </div>
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
