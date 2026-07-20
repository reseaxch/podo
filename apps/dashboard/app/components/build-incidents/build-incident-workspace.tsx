"use client"

import type {
  BuildIncident,
  BuildIncidentAuditEvent,
  BuildIncidentEvidence,
  BuildIncidentStatus,
  IncidentDelivery,
  IncidentRemediation,
} from "@podo/contracts"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { useToast } from "../../hooks/use-toast"
import type { DashboardShellContext } from "../../lib/dashboard-shell"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { Icon } from "../ui/pictogram"

export type BuildIncidentWorkspaceState = {
  incident: BuildIncident
  events: BuildIncidentAuditEvent[]
  remediation?: IncidentRemediation | null
  delivery?: IncidentDelivery | null
}

export type BuildIncidentWorkspaceController = {
  refresh(id: string): Promise<BuildIncidentWorkspaceState>
  startRetry(id: string): Promise<BuildIncidentWorkspaceState>
  decideRetry(
    id: string,
    approvalId: string,
    decision: "approve" | "deny",
  ): Promise<BuildIncidentWorkspaceState>
  startRemediation(id: string): Promise<BuildIncidentWorkspaceState>
  decideRemediation(
    id: string,
    approvalId: string,
    decision: "approve" | "deny",
  ): Promise<BuildIncidentWorkspaceState>
  startDelivery(id: string): Promise<BuildIncidentWorkspaceState>
  decideDelivery(
    id: string,
    approvalId: string,
    decision: "approve" | "deny",
  ): Promise<BuildIncidentWorkspaceState>
  startVerification(id: string): Promise<BuildIncidentWorkspaceState>
}

const statusLabels: Record<BuildIncidentStatus, string> = {
  investigating: "Investigating",
  awaiting_action: "Awaiting action",
  retry_pending_approval: "Retry approval required",
  retrying: "Retry dispatching",
  awaiting_ci_result: "Awaiting CI result",
  remediating: "Remediation in progress",
  verified: "CI verified",
  denied: "Action denied",
  failed: "Action failed",
}

function formatInstant(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

async function decode(
  response: Response,
): Promise<BuildIncidentWorkspaceState> {
  const body = (await response.json().catch(() => null)) as
    | (BuildIncidentWorkspaceState & { message?: string })
    | { message?: string }
    | null
  if (!response.ok || !body || !("incident" in body))
    throw new Error(
      body?.message ?? `Build incident action failed (${response.status})`,
    )
  return body
}

function apiController(): BuildIncidentWorkspaceController {
  const url = (id: string) =>
    `/api/podo/build-incidents/${encodeURIComponent(id)}`
  const command = (id: string, input: Record<string, string>) =>
    fetch(url(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(decode)
  return {
    refresh: (id) => fetch(url(id), { cache: "no-store" }).then(decode),
    startRetry: (id) => command(id, { action: "start-retry" }),
    decideRetry: (id, approvalId, decision) =>
      command(id, { action: "decide-retry", approvalId, decision }),
    startRemediation: (id) => command(id, { action: "start-remediation" }),
    decideRemediation: (id, approvalId, decision) =>
      command(id, { action: "decide-remediation", approvalId, decision }),
    startDelivery: (id) => command(id, { action: "start-delivery" }),
    decideDelivery: (id, approvalId, decision) =>
      command(id, { action: "decide-delivery", approvalId, decision }),
    startVerification: (id) => command(id, { action: "start-verification" }),
  }
}

const defaultController = apiController()
const coreShell: DashboardShellContext = {
  owner: { name: "Podo Core", avatar: "/brand/podo-logo.png" },
  source: "core",
}

function EvidenceRecord({ evidence }: { evidence: BuildIncidentEvidence }) {
  return (
    <li className="build-evidence-record motion-list-item">
      <span className="build-evidence-kind">
        {evidence.sourceType.replaceAll("_", " ")}
      </span>
      <strong>{evidence.summary}</strong>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{evidence.sourceId}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>
            {evidence.runId} · attempt {evidence.runAttempt}
          </dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd>
            <code>{evidence.headSha.slice(0, 12)}</code>
          </dd>
        </div>
      </dl>
    </li>
  )
}

function eventLabel(event: BuildIncidentAuditEvent) {
  return event.kind.replaceAll(".", " · ").replaceAll("_", " ")
}

export function BuildIncidentWorkspace({
  initial,
  controller = defaultController,
  shell = coreShell,
  mutationsEnabled = false,
}: {
  initial: BuildIncidentWorkspaceState
  controller?: BuildIncidentWorkspaceController
  shell?: DashboardShellContext
  mutationsEnabled?: boolean
}) {
  const [state, setState] = useState(initial)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [demoAction, setDemoAction] = useState<"retry" | "remediation" | null>(
    null,
  )
  const { toast, toastState, showToast } = useToast()
  const incident = state.incident
  const active = [
    "investigating",
    "retrying",
    "awaiting_ci_result",
    "remediating",
  ].includes(incident.status)

  const refresh = useCallback(async () => {
    const next = await controller.refresh(incident.id)
    setState(next)
    return next
  }, [controller, incident.id])

  async function run(
    label: string,
    action: () => Promise<BuildIncidentWorkspaceState>,
  ) {
    if (busyAction) return
    setBusyAction(label)
    setError(null)
    try {
      setState(await action())
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Build incident action failed",
      )
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      2500,
    )
    return () => window.clearInterval(timer)
  }, [active, refresh])

  const diagnosis = incident.diagnosis
  const retry = incident.retry
  const remediation = state.remediation ?? null
  const delivery = state.delivery ?? null
  const normalizedQuery = query.trim().toLowerCase()
  const visibleEvidence = useMemo(
    () =>
      normalizedQuery
        ? incident.evidence.filter((item) =>
            `${item.summary} ${item.sourceType} ${item.sourceId} ${item.headSha}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : incident.evidence,
    [incident.evidence, normalizedQuery],
  )
  const visibleEvents = useMemo(
    () =>
      normalizedQuery
        ? state.events.filter((event) =>
            eventLabel(event).toLowerCase().includes(normalizedQuery),
          )
        : state.events,
    [normalizedQuery, state.events],
  )

  return (
    <main className="app-shell build-detail-shell" data-ready="true">
      <IconRail />
      <Topbar
        current="Build incidents"
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={shell.owner}
        query={query}
        searchLabel="Search build incident"
        searchPlaceholder="Search evidence and audit events..."
        section="Incidents"
        source={shell.source}
      />
      <section className="build-detail-page">
        <nav className="build-detail-breadcrumb" aria-label="Breadcrumb">
          <Link href="/build-incidents">Build incidents</Link>
          <span>/</span>
          <strong>
            {incident.workflow.name} #{incident.sourceRun.runNumber}
          </strong>
        </nav>
        <header className="build-detail-heading">
          <div>
            <span className="eyebrow">GitHub Actions failure</span>
            <h1>
              {incident.workflow.name} #{incident.sourceRun.runNumber} failed
            </h1>
            <p className="build-detail-repository">
              <Icon name="github" size={14} />
              <strong>{incident.repository}</strong>
              <span>{incident.id}</span>
            </p>
          </div>
          <span className={`build-status build-status-${incident.status}`}>
            {statusLabels[incident.status]}
          </span>
        </header>

        <section
          aria-label="Build incident summary"
          className="build-detail-summary"
        >
          <div>
            <span>Run</span>
            <strong>#{incident.sourceRun.runNumber}</strong>
            <small>attempt {incident.sourceRun.attempt}</small>
          </div>
          <div>
            <span>Commit</span>
            <strong>
              <code>{incident.sourceRun.headSha.slice(0, 12)}</code>
            </strong>
            <small>
              {incident.sourceRun.headBranch ?? "branch unavailable"}
            </small>
          </div>
          <div>
            <span>Evidence</span>
            <strong>
              {formatCount(incident.evidence.length, "evidence record")}
            </strong>
            <small>attached by Core</small>
          </div>
          <div
            data-tone={
              diagnosis?.status === "validated" ? "verified" : undefined
            }
          >
            <span>Diagnosis</span>
            <strong>
              {diagnosis?.status === "validated"
                ? `${(diagnosis.confidence.value / 100).toFixed(0)}%`
                : diagnosis?.status === "failed"
                  ? "Failed"
                  : "Pending"}
            </strong>
            <small>confidence</small>
          </div>
        </section>

        {error ? (
          <div className="build-action-error" role="alert">
            <Icon name="warning-circle" size={18} />
            <span>
              <strong>Action did not complete</strong>
              {error}
            </span>
            <button
              disabled={Boolean(busyAction)}
              onClick={() => void run("refresh", refresh)}
              type="button"
            >
              Retry refresh
            </button>
          </div>
        ) : null}

        <div className="build-detail-layout">
          <div className="build-detail-main">
            <section
              className="build-panel build-motion-panel"
              aria-labelledby="run-title"
            >
              <header>
                <div>
                  <span className="eyebrow">Failed source run</span>
                  <h2 id="run-title">
                    Run {incident.sourceRun.id} · attempt{" "}
                    {incident.sourceRun.attempt}
                  </h2>
                </div>
                <a
                  href={incident.sourceRun.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open in GitHub <Icon name="arrow-square-out" size={13} />
                </a>
              </header>
              <dl className="build-run-facts">
                <div>
                  <dt>Workflow</dt>
                  <dd>{incident.workflow.path}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>
                    {incident.sourceRun.headBranch ?? "Not supplied by GitHub"}
                  </dd>
                </div>
                <div>
                  <dt>Commit</dt>
                  <dd>
                    <code>{incident.sourceRun.headSha}</code>
                  </dd>
                </div>
                <div>
                  <dt>Conclusion</dt>
                  <dd className="failed">{incident.sourceRun.conclusion}</dd>
                </div>
              </dl>
            </section>

            <section
              className="build-panel build-motion-panel"
              aria-labelledby="build-evidence-title"
            >
              <header>
                <div>
                  <span className="eyebrow">Core evidence</span>
                  <h2 id="build-evidence-title">
                    Workflow, job, and step records
                  </h2>
                </div>
                <span>
                  {visibleEvidence.length === incident.evidence.length
                    ? formatCount(incident.evidence.length, "record")
                    : `${visibleEvidence.length} of ${formatCount(incident.evidence.length, "record")}`}
                </span>
              </header>
              {visibleEvidence.length ? (
                <ul className="build-evidence-list">
                  {visibleEvidence.map((item) => (
                    <EvidenceRecord evidence={item} key={item.id} />
                  ))}
                </ul>
              ) : (
                <p className="build-panel-empty">
                  {normalizedQuery
                    ? "No evidence records match the current search."
                    : "Core has not attached build evidence yet. Investigation remains fail-closed."}
                </p>
              )}
            </section>

            <section
              className="build-panel build-motion-panel"
              aria-labelledby="build-audit-title"
            >
              <header>
                <div>
                  <span className="eyebrow">Immutable sequence</span>
                  <h2 id="build-audit-title">Build audit</h2>
                </div>
                <span>
                  {visibleEvents.length === state.events.length
                    ? formatCount(state.events.length, "event")
                    : `${visibleEvents.length} of ${formatCount(state.events.length, "event")}`}
                </span>
              </header>
              {visibleEvents.length ? (
                <ol className="build-audit-list">
                  {[...visibleEvents].reverse().map((event) => (
                    <li className="motion-list-item" key={event.sequence}>
                      <span>{event.sequence}</span>
                      <div>
                        <strong>{eventLabel(event)}</strong>
                        <time dateTime={event.occurredAt}>
                          {formatInstant(event.occurredAt)} UTC
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="build-panel-empty">
                  {normalizedQuery
                    ? "No audit events match the current search."
                    : "No audit events are available for this record."}
                </p>
              )}
            </section>
          </div>

          <aside
            className="build-decision-panel build-motion-panel"
            aria-labelledby="build-decision-title"
          >
            <header className="build-decision-heading">
              <div>
                <span className="eyebrow">Evidence-backed decision</span>
                <h2 id="build-decision-title">Next safe action</h2>
              </div>
              {diagnosis?.status === "validated" ? (
                <span className="build-confidence-badge">
                  {(diagnosis.confidence.value / 100).toFixed(0)}% confidence
                </span>
              ) : null}
            </header>
            {diagnosis?.status === "validated" ? (
              <>
                <section className="build-diagnosis-summary">
                  <span>Diagnosis</span>
                  <p>{diagnosis.summary}</p>
                </section>
                <section className="build-root-cause">
                  <h3>Probable root cause</h3>
                  <p>{diagnosis.probableRootCause}</p>
                </section>
                <section className="build-recommended-action">
                  <Icon name="caret-right" size={18} />
                  <div>
                    <h3>Recommended action</h3>
                    <p>{diagnosis.recommendedAction}</p>
                  </div>
                </section>
                <dl>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{(diagnosis.confidence.value / 100).toFixed(2)}%</dd>
                  </div>
                  <div>
                    <dt>Safe to attempt fix</dt>
                    <dd>{diagnosis.safeToAttemptFix ? "Yes" : "No"}</dd>
                  </div>
                </dl>
              </>
            ) : diagnosis?.status === "failed" ? (
              <p className="build-failed-copy">{diagnosis.error.message}</p>
            ) : (
              <p>
                Core is still producing a validated diagnosis. No mutation is
                available yet.
              </p>
            )}

            <div className="build-decision-actions">
              {!mutationsEnabled ? (
                incident.status === "verified" && incident.ciResult ? (
                  <a
                    className="primary-button"
                    href={incident.ciResult.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open verified CI run
                  </a>
                ) : (
                  <>
                    <div className="build-read-only-notice" role="status">
                      <Icon name="shield-check" size={16} />
                      <span>
                        <strong>
                          {shell.source === "demo"
                            ? "Demo workspace"
                            : "Read-only workspace"}
                        </strong>
                        {shell.source === "demo"
                          ? "This view uses real UI states without dispatching mutations to Core."
                          : "Live actions stay unavailable until authenticated operator access is implemented."}
                      </span>
                    </div>
                    {shell.source === "demo" ? (
                      <section
                        aria-labelledby="build-operator-actions-title"
                        className="build-operator-preview"
                      >
                        <div>
                          <span className="eyebrow">Action preview</span>
                          <h3 id="build-operator-actions-title">
                            Operator actions
                          </h3>
                          <p>
                            Connect authenticated operator access to enable
                            these approval-gated actions.
                          </p>
                        </div>
                        <button
                          className="primary-button"
                          onClick={() => setDemoAction("retry")}
                          type="button"
                        >
                          Request exact retry
                        </button>
                        {diagnosis?.status === "validated" &&
                        diagnosis.safeToAttemptFix ? (
                          <button
                            className="secondary-button"
                            onClick={() => setDemoAction("remediation")}
                            type="button"
                          >
                            Prepare tested remediation
                          </button>
                        ) : null}
                        {demoAction ? (
                          <div className="build-demo-approval" role="status">
                            <div>
                              <span className="eyebrow">
                                Demo approval request
                              </span>
                              <strong>
                                {demoAction === "retry"
                                  ? "Exact retry scope"
                                  : "Tested remediation scope"}
                              </strong>
                              <span>
                                {demoAction === "retry"
                                  ? `Run ${incident.sourceRun.id} · attempt ${incident.sourceRun.attempt}`
                                  : `Commit ${incident.sourceRun.headSha.slice(0, 12)}`}
                              </span>
                            </div>
                            <button
                              className="primary-button"
                              onClick={() => {
                                showToast(
                                  demoAction === "retry"
                                    ? "Demo approval completed — no retry was dispatched"
                                    : "Demo approval completed — no remediation was dispatched",
                                )
                                setDemoAction(null)
                              }}
                              type="button"
                            >
                              Simulate approval
                            </button>
                            <button
                              className="secondary-button"
                              onClick={() => setDemoAction(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </>
                )
              ) : incident.status === "awaiting_action" ? (
                <>
                  <button
                    className="primary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("retry", () =>
                        controller.startRetry(incident.id),
                      )
                    }
                    type="button"
                  >
                    {busyAction === "retry"
                      ? "Requesting…"
                      : "Request exact retry"}
                  </button>
                  {diagnosis?.status === "validated" &&
                  diagnosis.safeToAttemptFix ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(busyAction)}
                      onClick={() =>
                        void run("remediation", () =>
                          controller.startRemediation(incident.id),
                        )
                      }
                      type="button"
                    >
                      Prepare tested remediation
                    </button>
                  ) : null}
                </>
              ) : retry?.status === "pending_approval" ? (
                <>
                  <div className="build-approval-scope">
                    <strong>Exact retry scope</strong>
                    <span>
                      Run {retry.sourceRun.id} · attempt{" "}
                      {retry.sourceRun.attempt}
                    </span>
                    <code>{retry.sourceRun.headSha}</code>
                  </div>
                  <button
                    className="primary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("approve", () =>
                        controller.decideRetry(
                          incident.id,
                          retry.approval.id,
                          "approve",
                        ),
                      )
                    }
                    type="button"
                  >
                    Approve exact retry
                  </button>
                  <button
                    className="secondary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("deny", () =>
                        controller.decideRetry(
                          incident.id,
                          retry.approval.id,
                          "deny",
                        ),
                      )
                    }
                    type="button"
                  >
                    Deny retry
                  </button>
                </>
              ) : remediation?.status === "pending_approval" ? (
                <>
                  <div className="build-approval-scope">
                    <strong>Tested remediation scope</strong>
                    <span>{remediation.target}</span>
                    <code>{remediation.id}</code>
                  </div>
                  <button
                    className="primary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("approve-remediation", () =>
                        controller.decideRemediation(
                          incident.id,
                          remediation.approval.id,
                          "approve",
                        ),
                      )
                    }
                    type="button"
                  >
                    Approve tested remediation
                  </button>
                  <button
                    className="secondary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("deny-remediation", () =>
                        controller.decideRemediation(
                          incident.id,
                          remediation.approval.id,
                          "deny",
                        ),
                      )
                    }
                    type="button"
                  >
                    Deny remediation
                  </button>
                </>
              ) : remediation?.status === "completed" && !delivery ? (
                <button
                  className="primary-button"
                  disabled={Boolean(busyAction)}
                  onClick={() =>
                    void run("delivery", () =>
                      controller.startDelivery(incident.id),
                    )
                  }
                  type="button"
                >
                  Prepare pull request delivery
                </button>
              ) : delivery?.status === "pending_approval" ? (
                <>
                  <div className="build-approval-scope">
                    <strong>Pull request delivery</strong>
                    <span>Verified artifact {delivery.artifactId}</span>
                    <code>{delivery.id}</code>
                  </div>
                  <button
                    className="primary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("approve-delivery", () =>
                        controller.decideDelivery(
                          incident.id,
                          delivery.approval.id,
                          "approve",
                        ),
                      )
                    }
                    type="button"
                  >
                    Approve &amp; create PR
                  </button>
                  <button
                    className="secondary-button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      void run("deny-delivery", () =>
                        controller.decideDelivery(
                          incident.id,
                          delivery.approval.id,
                          "deny",
                        ),
                      )
                    }
                    type="button"
                  >
                    Deny delivery
                  </button>
                </>
              ) : delivery?.status === "delivered" &&
                !incident.remediationVerification ? (
                <button
                  className="primary-button"
                  disabled={Boolean(busyAction)}
                  onClick={() =>
                    void run("verification", () =>
                      controller.startVerification(incident.id),
                    )
                  }
                  type="button"
                >
                  Verify delivered remediation
                </button>
              ) : remediation?.status === "failed" ? (
                <p className="build-failed-copy">
                  {remediation.error?.message ?? "Remediation failed closed."}
                </p>
              ) : remediation?.status === "denied" ||
                delivery?.status === "denied" ? (
                <p className="build-failed-copy">
                  The requested mutation was denied. No further side effect was
                  dispatched.
                </p>
              ) : delivery?.status === "failed" ? (
                <p className="build-failed-copy">
                  {delivery.error?.message ?? "Pull request delivery failed."}
                </p>
              ) : active ? (
                <p className="build-active-state" role="status">
                  <Icon name="activity" size={15} /> Core is processing this
                  step…
                </p>
              ) : incident.status === "verified" && incident.ciResult ? (
                <a
                  className="primary-button"
                  href={incident.ciResult.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open verified CI run
                </a>
              ) : incident.status === "denied" ? (
                <p className="build-failed-copy">
                  The requested mutation was denied. No retry or remediation was
                  dispatched.
                </p>
              ) : incident.status === "failed" ? (
                <p className="build-failed-copy">
                  {retry?.error?.message ??
                    incident.remediationVerification?.error?.message ??
                    "Core failed closed. Review the audit before retrying."}
                </p>
              ) : null}
              <button
                className="build-refresh-action"
                disabled={Boolean(busyAction)}
                onClick={() => void run("refresh", refresh)}
                type="button"
              >
                Refresh Core state
              </button>
            </div>
          </aside>
        </div>
      </section>
      {toast ? (
        <div className="toast" data-motion-state={toastState} role="status">
          {toast}
        </div>
      ) : null}
    </main>
  )
}
