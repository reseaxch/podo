"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { useToast } from "../../hooks/use-toast"
import type {
  IncidentOverviewStatus,
  IncidentOverviewViewModel,
  IncidentSummary,
} from "../../lib/incident-overview-types"
import { incidentWorkspaceHref } from "../../lib/incident-links"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { Icon } from "../ui/pictogram"
import { SelectMenu } from "../ui/select-menu"

type ViewFilter = "Active" | "Awaiting approval" | "Resolved" | "All"
const pageSize = 6

const statusIcon: Record<
  IncidentOverviewStatus,
  "activity" | "check-circle" | "clock"
> = {
  Investigating: "activity",
  "Awaiting approval": "clock",
  Monitoring: "activity",
  Resolved: "check-circle",
}

function isVisibleForFilter(incident: IncidentSummary, filter: ViewFilter) {
  if (filter === "All") return true
  if (filter === "Active") return incident.status !== "Resolved"
  return incident.status === filter
}

export function IncidentsOverview({
  overview,
}: {
  overview: IncidentOverviewViewModel
}) {
  const [filter, setFilter] = useState<ViewFilter>("Active")
  const [service, setService] = useState("All services")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const { toast, showToast } = useToast()

  const services = useMemo(
    () => [
      "All services",
      ...Array.from(new Set(overview.incidents.map((item) => item.service))),
    ],
    [overview.incidents],
  )
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return overview.incidents.filter(
      (incident) =>
        isVisibleForFilter(incident, filter) &&
        (service === "All services" || incident.service === service) &&
        (!normalized ||
          `${incident.id} ${incident.title} ${incident.service} ${incident.diagnosis}`
            .toLowerCase()
            .includes(normalized)),
    )
  }, [filter, overview.incidents, query, service])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageStart = (page - 1) * pageSize
  const visibleIncidents = filtered.slice(pageStart, pageStart + pageSize)
  const visibleFrom = filtered.length ? pageStart + 1 : 0
  const visibleTo = Math.min(pageStart + pageSize, filtered.length)

  const activeCount = overview.incidents.filter(
    (item) => item.status !== "Resolved",
  ).length
  const diagnosedCount = overview.incidents.filter(
    (item) => item.confidence !== null,
  ).length

  function openIncident(incident: IncidentSummary) {
    if (incident.hasWorkspace) {
      window.location.assign(
        incidentWorkspaceHref({ incidentId: incident.id, tab: "evidence" }),
      )
      return
    }
    showToast(`${incident.id} detail is waiting for backend data`)
  }

  return (
    <main className="app-shell incidents-shell" data-ready="true">
      <IconRail />
      <Topbar
        onNotify={showToast}
        onQueryChange={(value) => {
          setQuery(value)
          setPage(1)
        }}
        owner={overview.owner}
        query={query}
        searchLabel="Search incidents"
        searchPlaceholder="Search incidents..."
      />
      <section className="incidents-page">
        <header className="incidents-heading">
          <div>
            <span className="eyebrow">Operational workspace</span>
            <h1>Incidents</h1>
            <p>
              Prioritize active investigations and move verified fixes forward.
            </p>
          </div>
          <div className="incidents-heading-actions">
            <span className="heading-live-context">
              <i className="metric-signal live" />
              <span>
                <strong>{activeCount} active</strong>
                <small>{diagnosedCount} diagnosed from Core</small>
              </span>
            </span>
            <Link className="secondary-button overview-toggle" href="/overview">
              <Icon name="squares-four" size={15} /> Overview
            </Link>
            <Link
              className="secondary-button refresh-button"
              href="/incidents"
            >
              <Icon name="activity" size={16} /> Refresh
            </Link>
          </div>
        </header>

        <section className="incident-inbox">
          <div className="incident-toolbar">
            <div className="incident-toolbar-title">
              <strong>Incident queue</strong>
              <small>{filtered.length} matching incidents</small>
            </div>
            <div
              className="incident-filter-tabs"
              role="tablist"
              aria-label="Incident status"
            >
              {(
                [
                  "Active",
                  "Awaiting approval",
                  "Resolved",
                  "All",
                ] as ViewFilter[]
              ).map((item) => (
                <button
                  aria-selected={filter === item}
                  key={item}
                  onClick={() => {
                    setFilter(item)
                    setPage(1)
                  }}
                  role="tab"
                  type="button"
                >
                  {item}
                  <span>
                    {
                      overview.incidents.filter((incident) =>
                        isVisibleForFilter(incident, item),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <SelectMenu
              label="Filter by service"
              leadingIcon="stack"
              onValueChange={(value) => {
                setService(value)
                setPage(1)
              }}
              options={services}
              value={service}
            />
          </div>

          <section className="incident-table" aria-label="Incidents">
            <div className="incident-table-head" aria-hidden="true">
              <span>Incident</span>
              <span>Investigation</span>
              <span>Working diagnosis</span>
              <span>Owner · updated</span>
            </div>
            {visibleIncidents.map((incident) => (
              <button
                className="incident-row"
                key={incident.id}
                onClick={() => openIncident(incident)}
                type="button"
              >
                <span className="sr-only">
                  Open {incident.id}: {incident.title}.{" "}
                </span>
                <span className="incident-primary">
                  <i
                    className={`severity severity-${incident.severity.toLowerCase()}`}
                  >
                    {incident.severity}
                  </i>
                  <span>
                    <strong>{incident.title}</strong>
                    <small>
                      {incident.id} · {incident.evidenceCount} evidence signals
                    </small>
                  </span>
                </span>
                <span className="incident-investigation">
                  <i
                    className={`overview-status status-${incident.status.toLowerCase().replaceAll(" ", "-")}`}
                  >
                    <Icon name={statusIcon[incident.status]} size={14} />{" "}
                    {incident.status}
                  </i>
                  <small className="incident-service">
                    <Icon name="cube" size={14} /> {incident.service}
                  </small>
                </span>
                <span className="incident-diagnosis">
                  <strong>{incident.diagnosis}</strong>
                  <small className="confidence-cell">
                    {incident.confidence ? (
                      <>
                        <span>{incident.confidence}% confidence</span>
                        <i>
                          <b style={{ width: `${incident.confidence}%` }} />
                        </i>
                      </>
                    ) : (
                      "Confidence pending"
                    )}
                  </small>
                </span>
                <span className="incident-updated">
                  <i title={incident.owner.name}>{incident.owner.initials}</i>
                  <span>
                    <strong>{incident.owner.name}</strong>
                    <small>{incident.updated}</small>
                  </span>
                  <Icon name="caret-right" size={15} />
                </span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="incident-zero-state">
                <Icon name="magnifying-glass" size={20} />
                <strong>No incidents match these filters</strong>
                <span>Try another status, service, or search term.</span>
                <button
                  onClick={() => {
                    setFilter("All")
                    setService("All services")
                    setQuery("")
                    setPage(1)
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            ) : null}
          </section>
          <footer className="incident-inbox-footer">
            <span className="pipeline-health">
              <i className="metric-signal live" /> Evidence pipeline healthy
            </span>
            <span className="pagination-summary" aria-live="polite">
              {overview.generatedAt} · Showing {visibleFrom}–{visibleTo} of{" "}
              {filtered.length}
            </span>
            <nav className="table-pagination" aria-label="Incident pages">
              <button
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                <Icon name="caret-right" size={14} />
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map(
                (pageNumber) => (
                  <button
                    aria-current={page === pageNumber ? "page" : undefined}
                    aria-label={`Page ${pageNumber}`}
                    key={pageNumber}
                    onClick={() => setPage(pageNumber)}
                    type="button"
                  >
                    {pageNumber}
                  </button>
                ),
              )}
              <button
                aria-label="Next page"
                disabled={page === pageCount}
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
                type="button"
              >
                <Icon name="caret-right" size={14} />
              </button>
            </nav>
          </footer>
        </section>
      </section>
      {toast ? (
        <div className="toast" role="status">
          <Icon name="check-circle" size={18} /> {toast}
        </div>
      ) : null}
    </main>
  )
}
