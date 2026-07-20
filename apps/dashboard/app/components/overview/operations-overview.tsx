"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { useToast } from "../../hooks/use-toast"
import { incidentWorkspaceHref } from "../../lib/incident-links"
import type { IncidentSummary } from "../../lib/incident-overview-types"
import type { OperationsOverviewViewModel } from "../../lib/operations-overview-types"
import { runViewTransition } from "../../lib/view-transition"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { AnimatedNumber } from "../ui/animated-number"
import { Icon } from "../ui/pictogram"
import styles from "./operations-overview.module.css"

export function OperationsOverview({
  overview,
  source = "demo",
}: {
  overview: OperationsOverviewViewModel
  source?: "demo" | "core"
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<"all" | "mine">("all")
  const { toast, toastState, showToast } = useToast()

  const active = overview.incidents.filter(
    (incident) => incident.status !== "Resolved",
  )
  const decisions = active.filter(
    (incident) =>
      incident.severity === "P1" || incident.status === "Awaiting approval",
  )
  const scoped =
    scope === "mine"
      ? active.filter((incident) => incident.owner.name === overview.owner.name)
      : active
  const normalizedQuery = query.trim().toLowerCase()
  const visible = scoped.filter((incident) =>
    `${incident.id} ${incident.title} ${incident.service} ${incident.diagnosis}`
      .toLowerCase()
      .includes(normalizedQuery),
  )
  const criticalCount = active.filter(
    (incident) => incident.severity === "P1",
  ).length
  const approvalCount = active.filter(
    (incident) => incident.status === "Awaiting approval",
  ).length
  const affectedServiceCount = new Set(
    active.map((incident) => incident.service),
  ).size

  function openIncident(
    incident: IncidentSummary,
    tab: "evidence" | "graph" | "changes" = "evidence",
  ) {
    if (!incident.hasWorkspace) return
    router.push(incidentWorkspaceHref({ incidentId: incident.id, tab }))
  }

  return (
    <main className="app-shell" data-ready="true">
      <IconRail />
      <Topbar
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={overview.owner}
        query={query}
        searchLabel="Search overview"
        searchPlaceholder="Search incidents and services..."
        section="Overview"
        source={source}
      />

      <section className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <span className="eyebrow">Operational command center</span>
            <h1>Overview</h1>
            <p>
              Decisions, system pressure, and active investigations in one
              place.
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.liveStatus}>
              <i /> Live · {overview.generatedAt.toLowerCase()}
            </span>
            <button
              className="secondary-button"
              onClick={() => showToast("Overview refreshed")}
              type="button"
            >
              <Icon name="activity" size={15} /> Refresh
            </button>
          </div>
        </header>

        <section className={styles.posture} aria-label="Operational posture">
          <div className={styles.postureLead}>
            <span className={styles.postureIcon}>
              <Icon name="shield-check" size={20} />
            </span>
            <div>
              <span className="eyebrow">Current posture</span>
              <strong>{decisions.length} decisions need attention</strong>
              <small>
                Production mutations remain blocked until human approval.
              </small>
            </div>
            <Link href="/safety">
              Review approvals <Icon name="caret-right" size={13} />
            </Link>
          </div>
          <div className={styles.postureMetric}>
            <small>Active</small>
            <strong>
              <AnimatedNumber value={active.length} />
            </strong>
            <span>investigations</span>
          </div>
          <div className={styles.postureMetric}>
            <small>Critical</small>
            <strong className={styles.criticalValue}>
              <AnimatedNumber value={criticalCount} />
            </strong>
            <span>P1 incidents</span>
          </div>
          <div className={styles.postureMetric}>
            <small>Approval</small>
            <strong>
              <AnimatedNumber value={approvalCount} />
            </strong>
            <span>waiting</span>
          </div>
          <div className={styles.postureMetric}>
            <small>Affected services</small>
            <strong>
              <AnimatedNumber value={affectedServiceCount} />
            </strong>
            <span>{criticalCount} on critical paths</span>
          </div>
        </section>

        <section className={styles.primaryGrid}>
          <article className={styles.decisionPanel}>
            <header className={styles.panelHeader}>
              <div>
                <span className="eyebrow">Decision queue</span>
                <h2>What needs you now</h2>
              </div>
              <Link href="/incidents">Open incident queue</Link>
            </header>
            <div className={styles.decisionList}>
              {decisions.slice(0, 3).map((incident, index) => (
                <button
                  aria-label={
                    incident.hasWorkspace
                      ? `Open decision incident ${incident.id}: ${incident.title}`
                      : `${incident.id}: ${incident.title}. Workspace unavailable`
                  }
                  className={
                    incident.hasWorkspace ? undefined : styles.unavailableRow
                  }
                  disabled={!incident.hasWorkspace}
                  key={`${scope}-${normalizedQuery}-${incident.id}`}
                  onClick={() =>
                    openIncident(
                      incident,
                      incident.status === "Awaiting approval"
                        ? "changes"
                        : "graph",
                    )
                  }
                  type="button"
                  style={{ viewTransitionName: `overview-${incident.id}` }}
                >
                  <span className={styles.rank}>0{index + 1}</span>
                  <i
                    className={`${styles.severity} ${styles[incident.severity.toLowerCase()]}`}
                  >
                    {incident.severity}
                  </i>
                  <span className={styles.decisionCopy}>
                    <strong>{incident.title}</strong>
                    <small>
                      <em>{incident.attentionReason ?? "Needs review"}</em>
                      <span>{incident.service}</span>
                    </small>
                  </span>
                  <span className={styles.owner}>
                    <i>{incident.owner.initials}</i>
                    <small>{incident.updated}</small>
                  </span>
                  {incident.hasWorkspace ? (
                    <Icon name="caret-right" size={14} />
                  ) : (
                    <span className={styles.availability}>Summary only</span>
                  )}
                </button>
              ))}
            </div>
          </article>

          <article className={styles.signalsPanel}>
            <header className={styles.panelHeader}>
              <div>
                <span className="eyebrow">System posture</span>
                <h2>Live control surfaces</h2>
              </div>
            </header>
            <div className={styles.signalList}>
              {overview.signals.map((signal) => (
                <Link
                  aria-label={`Open ${signal.label}: ${signal.value}`}
                  href={signal.href}
                  key={signal.label}
                >
                  <i
                    className={`${styles.signalDot} ${styles[`signal${signal.tone[0]!.toUpperCase()}${signal.tone.slice(1)}`]}`}
                  />
                  <span>
                    <small>{signal.label}</small>
                    <strong>{signal.value}</strong>
                    <em>{signal.detail}</em>
                  </span>
                  <Icon name="caret-right" size={14} />
                </Link>
              ))}
            </div>
          </article>
        </section>

        <section className={styles.secondaryGrid}>
          <article className={styles.investigationsPanel}>
            <header className={styles.panelHeader}>
              <div>
                <span className="eyebrow">Active investigations</span>
                <h2>{visible.length} in view</h2>
              </div>
              <div className={styles.scopeToggle} aria-label="Incident scope">
                <button
                  aria-pressed={scope === "all"}
                  onClick={() => void runViewTransition(() => setScope("all"))}
                  type="button"
                >
                  All active
                </button>
                <button
                  aria-pressed={scope === "mine"}
                  onClick={() => void runViewTransition(() => setScope("mine"))}
                  type="button"
                >
                  My work
                </button>
              </div>
            </header>
            <div className={styles.investigationList}>
              {visible.slice(0, 5).map((incident) => (
                <button
                  aria-label={
                    incident.hasWorkspace
                      ? `Open active incident ${incident.id}: ${incident.title}`
                      : `${incident.id}: ${incident.title}. Workspace unavailable`
                  }
                  className={
                    incident.hasWorkspace ? undefined : styles.unavailableRow
                  }
                  disabled={!incident.hasWorkspace}
                  key={incident.id}
                  onClick={() => openIncident(incident, "evidence")}
                  type="button"
                >
                  <i
                    className={`${styles.severity} ${styles[incident.severity.toLowerCase()]}`}
                  >
                    {incident.severity}
                  </i>
                  <span>
                    <strong>{incident.title}</strong>
                    <small>
                      {incident.id} · {incident.service}
                    </small>
                  </span>
                  <span className={styles.diagnosis}>
                    <strong>{incident.diagnosis}</strong>
                    <small>{incident.confidence ?? "—"}% confidence</small>
                  </span>
                  <span className={styles.state}>
                    {incident.hasWorkspace ? incident.status : "Summary only"}
                  </span>
                </button>
              ))}
              {visible.length === 0 ? (
                <div className={styles.emptyState}>
                  <Icon name="magnifying-glass" size={18} />
                  <strong>No active investigations match</strong>
                  <span>Clear the search or switch the scope.</span>
                </div>
              ) : null}
            </div>
          </article>

          <article className={styles.activityPanel}>
            <header className={styles.panelHeader}>
              <div>
                <span className="eyebrow">Recent activity</span>
                <h2>Human + agent actions</h2>
              </div>
              <Link href="/audit">Open audit log</Link>
            </header>
            <div className={styles.activityList}>
              {overview.activity.map((item) => (
                <Link href={item.href} key={item.id}>
                  <span
                    className={`${styles.activityMark} ${styles[item.kind]}`}
                  >
                    <Icon
                      name={
                        item.kind === "human"
                          ? "shield-check"
                          : item.kind === "agent"
                            ? "git-fork"
                            : "activity"
                      }
                      size={14}
                    />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <em>
                      {item.actor} · {item.time}
                    </em>
                  </span>
                </Link>
              ))}
            </div>
          </article>
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
