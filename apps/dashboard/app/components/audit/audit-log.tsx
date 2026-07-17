"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { useToast } from "../../hooks/use-toast"
import { runViewTransition } from "../../lib/view-transition"
import type { AuditEvent, AuditLogViewModel } from "../../lib/audit-types"
import {
  auditEventIncidentTab,
  incidentWorkspaceHref,
} from "../../lib/incident-links"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { Icon } from "../ui/pictogram"
import { SelectMenu } from "../ui/select-menu"
import styles from "./audit-log.module.css"

type AuditView = "All activity" | "Agent actions" | "Approvals" | "Exceptions"

const defaultPageSize = 25

const outcomeIcon = {
  Success: "check-circle",
  Pending: "clock",
  Blocked: "shield-check",
  Failed: "warning-circle",
} as const

function isVisibleForView(event: AuditEvent, view: AuditView) {
  if (view === "All activity") return true
  if (view === "Agent actions") return event.actor.type === "Agent"
  if (view === "Approvals") return event.category === "Approval"
  return event.outcome === "Blocked" || event.outcome === "Failed"
}

function escapeCsv(value: string | number | null) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`
}

export function AuditLog({
  audit,
  initialEventId,
  source = "demo",
}: {
  audit: AuditLogViewModel
  initialEventId?: string | undefined
  source?: "demo" | "core"
}) {
  const [query, setQuery] = useState("")
  const [view, setView] = useState<AuditView>("All activity")
  const [category, setCategory] = useState("All categories")
  const [actor, setActor] = useState("All actors")
  const [outcome, setOutcome] = useState("All outcomes")
  const [selectedId, setSelectedId] = useState(
    initialEventId && audit.events.some((event) => event.id === initialEventId)
      ? initialEventId
      : (audit.events[0]?.id ?? ""),
  )
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [page, setPage] = useState(1)
  const [live, setLive] = useState(true)
  const { toast, toastState, showToast } = useToast()

  const categories = useMemo(
    () => [
      "All categories",
      ...Array.from(new Set(audit.events.map((event) => event.category))),
    ],
    [audit.events],
  )
  const actors = useMemo(
    () => [
      "All actors",
      ...Array.from(new Set(audit.events.map((event) => event.actor.name))),
    ],
    [audit.events],
  )
  const outcomes = ["All outcomes", "Success", "Pending", "Blocked", "Failed"]

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return audit.events.filter(
      (event) =>
        isVisibleForView(event, view) &&
        (category === "All categories" || event.category === category) &&
        (actor === "All actors" || event.actor.name === actor) &&
        (outcome === "All outcomes" || event.outcome === outcome) &&
        (!normalized ||
          [
            event.id,
            event.title,
            event.summary,
            event.actor.name,
            event.action,
            event.incidentId,
            event.service,
            event.source,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalized)),
    )
  }, [actor, audit.events, category, outcome, query, view])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageStart = (safePage - 1) * pageSize
  const visibleEvents = filtered.slice(pageStart, pageStart + pageSize)
  const selectedEvent =
    filtered.find((event) => event.id === selectedId) ?? filtered[0] ?? null
  const groups = visibleEvents.reduce<
    Array<{ label: string; events: AuditEvent[] }>
  >((result, event) => {
    const current = result.at(-1)
    if (current?.label === event.dateGroup) current.events.push(event)
    else result.push({ label: event.dateGroup, events: [event] })
    return result
  }, [])

  const successCount = audit.events.filter(
    (event) => event.outcome === "Success",
  ).length
  const approvalCount = audit.events.filter(
    (event) => event.category === "Approval",
  ).length
  const exceptionCount = audit.events.filter(
    (event) => event.outcome === "Blocked" || event.outcome === "Failed",
  ).length

  function resetFilters() {
    setQuery("")
    setView("All activity")
    setCategory("All categories")
    setActor("All actors")
    setOutcome("All outcomes")
    setPage(1)
  }

  function exportCsv() {
    const header = [
      "Event ID",
      "Occurred at",
      "Actor",
      "Category",
      "Outcome",
      "Action",
      "Incident",
      "Service",
      "Summary",
      "Integrity hash",
    ]
    const rows = filtered.map((event) => [
      event.id,
      event.occurredAt,
      event.actor.name,
      event.category,
      event.outcome,
      event.action,
      event.incidentId,
      event.service,
      event.summary,
      event.integrityHash,
    ])
    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "podo-audit-log.csv"
    link.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${filtered.length} audit events`)
  }

  async function copyEvent(event: AuditEvent) {
    await navigator.clipboard?.writeText(JSON.stringify(event, null, 2))
    showToast(`${event.id} JSON copied`)
  }

  return (
    <main className="app-shell" data-ready="true">
      <IconRail />
      <Topbar
        onNotify={showToast}
        onQueryChange={(value) => {
          setQuery(value)
          setPage(1)
        }}
        owner={audit.owner}
        query={query}
        searchLabel="Search audit log"
        searchPlaceholder="Search actor, action, incident..."
        section="Audit log"
        source={source}
      />

      <section className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <span className="eyebrow">Governance workspace</span>
            <h1>Audit log</h1>
            <p>
              Every agent, human, tool, approval, and delivery action in one
              immutable trail.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              aria-pressed={live}
              className={styles.liveButton}
              onClick={() => {
                setLive((current) => !current)
                showToast(live ? "Live stream paused" : "Live stream resumed")
              }}
              type="button"
            >
              <i className={live ? styles.liveDot : styles.pausedDot} />
              {live ? "Live" : "Paused"}
            </button>
            <button
              className="secondary-button"
              onClick={exportCsv}
              type="button"
            >
              <Icon name="arrow-down" size={15} /> Export CSV
            </button>
          </div>
        </header>

        <section className={styles.integrityStrip} aria-label="Audit summary">
          <div className={styles.integrityLead}>
            <span className={styles.integrityIcon}>
              <Icon name="shield-check" size={20} />
            </span>
            <span>
              <strong>
                {source === "core"
                  ? "Integrity verification not provided"
                  : "Audit chain verified"}
              </strong>
              <small>
                {source === "core"
                  ? "Retention policy is not supplied by Core"
                  : `All event hashes are intact · retention ${audit.retentionDays} days`}
              </small>
            </span>
          </div>
          <div className={styles.summaryMetric}>
            <small>Total events</small>
            <strong>{audit.events.length}</strong>
          </div>
          <div className={styles.summaryMetric}>
            <small>Successful</small>
            <strong>{successCount}</strong>
          </div>
          <div className={styles.summaryMetric}>
            <small>Approval events</small>
            <strong>{approvalCount}</strong>
          </div>
          <div className={`${styles.summaryMetric} ${styles.exceptionMetric}`}>
            <small>Exceptions</small>
            <strong>{exceptionCount}</strong>
          </div>
        </section>

        <section className={styles.workspace}>
          <div className={styles.streamPanel}>
            <div className={styles.streamToolbar}>
              <div
                className={styles.viewTabs}
                role="tablist"
                aria-label="Audit views"
              >
                {(
                  [
                    "All activity",
                    "Agent actions",
                    "Approvals",
                    "Exceptions",
                  ] as AuditView[]
                ).map((item) => (
                  <button
                    aria-selected={view === item}
                    key={item}
                    onClick={() =>
                      void runViewTransition(() => {
                        setView(item)
                        setPage(1)
                      })
                    }
                    role="tab"
                    type="button"
                  >
                    {item}
                    <span>
                      {
                        audit.events.filter((event) =>
                          isVisibleForView(event, item),
                        ).length
                      }
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.facets}>
                <SelectMenu
                  label="Filter by category"
                  leadingIcon="stack"
                  onValueChange={(value) =>
                    void runViewTransition(() => {
                      setCategory(value)
                      setPage(1)
                    })
                  }
                  options={categories}
                  value={category}
                />
                <SelectMenu
                  label="Filter by actor"
                  leadingIcon="terminal-window"
                  onValueChange={(value) =>
                    void runViewTransition(() => {
                      setActor(value)
                      setPage(1)
                    })
                  }
                  options={actors}
                  value={actor}
                />
                <SelectMenu
                  label="Filter by outcome"
                  leadingIcon="check-circle"
                  onValueChange={(value) =>
                    void runViewTransition(() => {
                      setOutcome(value)
                      setPage(1)
                    })
                  }
                  options={outcomes}
                  value={outcome}
                />
              </div>
            </div>

            <div className={styles.streamHeader}>
              <span>Chronological activity</span>
              <small>{filtered.length} matching events · newest first</small>
            </div>

            <div className={styles.eventStream} aria-label="Audit events">
              <table className={styles.auditTable}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Actor</th>
                    <th>Category</th>
                    <th>Resource</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                {groups.map((group) => (
                  <tbody key={group.label}>
                    <tr className={styles.dateRow}>
                      <th colSpan={6} scope="rowgroup">
                        {group.label}
                      </th>
                    </tr>
                    {group.events.map((event) => (
                      <tr
                        aria-label={`Inspect ${event.id}: ${event.title}`}
                        aria-selected={selectedEvent?.id === event.id}
                        className={`${styles.motionRow} ${
                          selectedEvent?.id === event.id
                            ? styles.selectedTableRow
                            : ""
                        }`}
                        key={`${view}-${category}-${actor}-${outcome}-${safePage}-${event.id}`}
                        onClick={() => setSelectedId(event.id)}
                        onKeyDown={(keyboardEvent) => {
                          if (
                            keyboardEvent.key === "Enter" ||
                            keyboardEvent.key === " "
                          ) {
                            keyboardEvent.preventDefault()
                            setSelectedId(event.id)
                          }
                        }}
                        style={{ viewTransitionName: `audit-${event.id}` }}
                        tabIndex={0}
                      >
                        <td className={styles.tableTime}>
                          <strong>{event.time}</strong>
                          <small>{event.duration ?? event.source}</small>
                        </td>
                        <td>
                          <span className={styles.eventButton}>
                            <span
                              className={`${styles.eventIcon} ${styles[`category${event.category}`]}`}
                            >
                              <Icon name={event.icon} size={15} />
                            </span>
                            <span className={styles.eventCopy}>
                              <strong>{event.title}</strong>
                              <small>{event.summary}</small>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={styles.actorCell}>
                            <i>{event.actor.initials}</i>
                            <span>
                              <strong>{event.actor.name}</strong>
                              <small>{event.actor.type}</small>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={styles.categoryCell}>
                            {event.category}
                          </span>
                        </td>
                        <td>
                          <span className={styles.resourceCell}>
                            <strong>
                              {event.incidentId ?? event.resource}
                            </strong>
                            <small>{event.service ?? event.source}</small>
                          </span>
                        </td>
                        <td>
                          <i
                            className={`${styles.outcome} ${styles[`outcome${event.outcome}`]}`}
                          >
                            <Icon name={outcomeIcon[event.outcome]} size={12} />
                            {event.outcome}
                          </i>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>

              {!filtered.length ? (
                <div className={styles.emptyState}>
                  <Icon name="magnifying-glass" size={22} />
                  <strong>No audit events match these filters</strong>
                  <span>
                    Try another actor, category, outcome, or search query.
                  </span>
                  <button onClick={resetFilters} type="button">
                    Clear filters
                  </button>
                </div>
              ) : null}
            </div>

            <footer className={styles.streamFooter}>
              <span>
                <Icon name="shield-check" size={14} /> Immutable append-only
                stream
              </span>
              <div className={styles.pagination}>
                <span>
                  {filtered.length
                    ? `${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length}`
                    : "0 events"}
                </span>
                <SelectMenu
                  label="Rows per page"
                  onValueChange={(value) => {
                    setPageSize(Number.parseInt(value, 10))
                    setPage(1)
                  }}
                  options={["25 rows", "50 rows", "100 rows"]}
                  value={`${pageSize} rows`}
                />
                <button
                  aria-label="Previous audit page"
                  disabled={safePage === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  <span className={styles.previousIcon}>
                    <Icon name="caret-right" size={13} />
                  </span>
                </button>
                <strong>
                  {safePage} / {pageCount}
                </strong>
                <button
                  aria-label="Next audit page"
                  disabled={safePage === pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                  type="button"
                >
                  <Icon name="caret-right" size={13} />
                </button>
              </div>
            </footer>
          </div>

          <aside className={styles.inspector} aria-label="Event inspector">
            {selectedEvent ? (
              <>
                <header className={styles.inspectorHeader}>
                  <div>
                    <span className="eyebrow">Event inspector</span>
                    <h2>{selectedEvent.title}</h2>
                    <p>
                      {selectedEvent.id} · {selectedEvent.occurredAt}
                    </p>
                  </div>
                  <i
                    className={`${styles.outcome} ${styles[`outcome${selectedEvent.outcome}`]}`}
                  >
                    <Icon name={outcomeIcon[selectedEvent.outcome]} size={13} />
                    {selectedEvent.outcome}
                  </i>
                </header>

                <section className={styles.actorCard}>
                  <i>{selectedEvent.actor.initials}</i>
                  <span>
                    <small>{selectedEvent.actor.type}</small>
                    <strong>{selectedEvent.actor.name}</strong>
                  </span>
                  <span>
                    <small>Source</small>
                    <strong>{selectedEvent.source}</strong>
                  </span>
                </section>

                <section className={styles.inspectorSection}>
                  <header>
                    <strong>Action context</strong>
                    <code>{selectedEvent.action}</code>
                  </header>
                  <div className={styles.detailGrid}>
                    {selectedEvent.details.map((detail) => (
                      <span key={detail.label}>
                        <small>{detail.label}</small>
                        <strong>{detail.value}</strong>
                      </span>
                    ))}
                  </div>
                </section>

                <section className={styles.inspectorSection}>
                  <header>
                    <strong>Recorded payload</strong>
                    <button
                      onClick={() => void copyEvent(selectedEvent)}
                      type="button"
                    >
                      <Icon name="copy" size={13} /> Copy JSON
                    </button>
                  </header>
                  <pre>{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
                </section>

                <section className={styles.integrityCard}>
                  <Icon
                    name={source === "core" ? "warning-circle" : "shield-check"}
                    size={17}
                  />
                  <span>
                    <small>
                      {source === "core"
                        ? "Core event identity"
                        : "Integrity hash"}
                    </small>
                    <code>
                      {source === "core"
                        ? selectedEvent.id
                        : selectedEvent.integrityHash}
                    </code>
                  </span>
                  <i>{source === "core" ? "Not verified" : "Verified"}</i>
                </section>

                {selectedEvent.incidentId ? (
                  <Link
                    aria-label={`Open ${selectedEvent.incidentId} ${auditEventIncidentTab(selectedEvent)} context`}
                    className={styles.openIncident}
                    href={incidentWorkspaceHref({
                      eventId: selectedEvent.id,
                      incidentId: selectedEvent.incidentId,
                      tab: auditEventIncidentTab(selectedEvent),
                    })}
                  >
                    Open {selectedEvent.incidentId} ·{" "}
                    {auditEventIncidentTab(selectedEvent)}
                    <Icon name="arrow-square-out" size={15} />
                  </Link>
                ) : null}
              </>
            ) : (
              <div className={styles.inspectorEmpty}>
                <Icon name="file-text" size={23} />
                <strong>Select an audit event</strong>
                <span>
                  Event details and integrity metadata will appear here.
                </span>
              </div>
            )}
          </aside>
        </section>
      </section>

      {toast ? (
        <div className="toast" data-motion-state={toastState} role="status">
          <Icon name="check-circle" size={18} /> {toast}
        </div>
      ) : null}
    </main>
  )
}
