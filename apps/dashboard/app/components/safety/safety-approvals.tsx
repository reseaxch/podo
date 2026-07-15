"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useToast } from "../../hooks/use-toast"
import type {
  ApprovalDecisionInput,
  ApprovalRequest,
  SafetyApprovalsController,
  SafetyApprovalsViewModel,
} from "../../lib/safety-types"
import { createMockSafetyController } from "../../mocks/safety-controller"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { Icon } from "../ui/pictogram"
import { SelectMenu } from "../ui/select-menu"
import styles from "./safety-approvals.module.css"

type SafetyTab = "pending" | "history" | "policies"
type RiskFilter = "all" | ApprovalRequest["risk"]
type DecisionDraft = { decision: "approve" | "deny"; requestId: string }

const kindIcons = {
  pull_request: "git-branch",
  command: "terminal-window",
  permission: "shield-check",
} as const
const riskOptions = [
  { value: "all", label: "All risks" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
] as const

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function createCoreSafetyController(): SafetyApprovalsController {
  return {
    async decide(input) {
      const response = await fetch("/api/podo/safety", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
      const result = (await response.json()) as
        SafetyApprovalsViewModel | { message?: string }
      if (!response.ok)
        throw new Error(
          "message" in result && result.message
            ? result.message
            : `Approval failed (${response.status})`,
        )
      return result as SafetyApprovalsViewModel
    },
  }
}

export function SafetyApprovals({
  initial,
  controller,
  source = "demo",
}: {
  initial: SafetyApprovalsViewModel
  controller?: SafetyApprovalsController
  source?: "demo" | "core"
}) {
  const controllerRef = useRef(
    controller ??
      (source === "core"
        ? createCoreSafetyController()
        : createMockSafetyController(initial)),
  )
  const [view, setView] = useState(initial)
  const [tab, setTab] = useState<SafetyTab>("pending")
  const [query, setQuery] = useState("")
  const [risk, setRisk] = useState<RiskFilter>("all")
  const [selectedId, setSelectedId] = useState(
    initial.requests.find((request) => request.status === "pending")?.id ?? "",
  )
  const [draft, setDraft] = useState<DecisionDraft | null>(null)
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decisionTriggerRef = useRef<HTMLElement | null>(null)
  const { toast, showToast } = useToast()

  const pending = useMemo(
    () =>
      view.requests.filter((request) => {
        if (request.status !== "pending") return false
        if (risk !== "all" && request.risk !== risk) return false
        const search = query.trim().toLowerCase()
        if (!search) return true
        return [
          request.id,
          request.incidentId,
          request.title,
          request.service,
          request.action,
        ].some((value) => value.toLowerCase().includes(search))
      }),
    [query, risk, view.requests],
  )

  const filteredHistory = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return view.history
    return view.history.filter((item) =>
      [
        item.requestId,
        item.title,
        item.incidentId,
        item.decision,
        item.actor,
        item.reason,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search),
    )
  }, [query, view.history])

  const filteredPolicies = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return view.policies
    return view.policies.filter((policy) =>
      [
        policy.id,
        policy.name,
        policy.description,
        policy.coverage,
        ...policy.rules,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search),
    )
  }, [query, view.policies])

  const activeSelectedId = pending.some((request) => request.id === selectedId)
    ? selectedId
    : (pending[0]?.id ?? "")
  const selected = view.requests.find(
    (request) => request.id === activeSelectedId,
  )
  const blockedCount = view.requests.filter(
    (request) => request.status === "pending" && !request.canApprove,
  ).length

  function beginDecision(decision: DecisionDraft["decision"]) {
    if (!selected) return
    decisionTriggerRef.current = document.activeElement as HTMLElement | null
    setDraft({ decision, requestId: selected.id })
    setReason("")
    setConfirmed(false)
    setError(null)
  }

  const closeDecision = useCallback(() => {
    if (submitting) return
    setDraft(null)
    setReason("")
    setConfirmed(false)
    setError(null)
    window.requestAnimationFrame(() => decisionTriggerRef.current?.focus())
  }, [submitting])

  async function submitDecision() {
    if (!draft || !reason.trim() || !confirmed || submitting) return
    setSubmitting(true)
    setError(null)
    const input: ApprovalDecisionInput = {
      requestId: draft.requestId,
      decision: draft.decision,
      reason: reason.trim(),
      expectedStatus: "pending",
      expectedRevision: view.revision,
    }
    try {
      const next = await controllerRef.current.decide(input)
      setView(next)
      closeDecision()
      showToast(
        draft.decision === "approve"
          ? `${draft.requestId} approved`
          : `${draft.requestId} denied`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The decision was not saved",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={`app-shell ${styles.shell}`} data-ready="true">
      <IconRail />
      <Topbar
        current="Safety & approvals"
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={view.owner}
        query={query}
        searchLabel="Search safety and approvals"
        searchPlaceholder="Search approvals, decisions, policies..."
      />

      <section className={styles.page}>
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Guardrail control</span>
            <div className={styles.titleRow}>
              <h1>Safety & approvals</h1>
              <span className={styles.live}>
                <i /> Enforced
              </span>
            </div>
            <p>
              Review every agent action before it crosses a safety boundary.
            </p>
          </div>
          <div className={styles.posture} aria-label="Safety posture">
            <span>
              <strong>
                {
                  view.requests.filter((item) => item.status === "pending")
                    .length
                }
              </strong>
              <small>pending</small>
            </span>
            <span className={styles.alertMetric}>
              <strong>{blockedCount}</strong>
              <small>policy blocked</small>
            </span>
            <span>
              <strong>{view.history.length}</strong>
              <small>reviewed</small>
            </span>
            <span>
              <strong className={styles.secure}>Locked</strong>
              <small>production</small>
            </span>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="Safety views" role="tablist">
          <button
            aria-controls="safety-panel-pending"
            id="safety-tab-pending"
            aria-selected={tab === "pending"}
            onClick={() => setTab("pending")}
            role="tab"
            type="button"
          >
            Pending
            <span>
              {view.requests.filter((item) => item.status === "pending").length}
            </span>
          </button>
          <button
            aria-controls="safety-panel-history"
            id="safety-tab-history"
            aria-selected={tab === "history"}
            onClick={() => setTab("history")}
            role="tab"
            type="button"
          >
            Decision history
            <span>{view.history.length}</span>
          </button>
          <button
            aria-controls="safety-panel-policies"
            id="safety-tab-policies"
            aria-selected={tab === "policies"}
            onClick={() => setTab("policies")}
            role="tab"
            type="button"
          >
            Policies
            <span>{view.policies.length}</span>
          </button>
        </nav>

        {tab === "pending" ? (
          <div
            aria-labelledby="safety-tab-pending"
            className={styles.workspace}
            id="safety-panel-pending"
            role="tabpanel"
          >
            <section
              className={styles.queue}
              aria-label="Pending approval queue"
            >
              <div className={styles.queueToolbar}>
                <div>
                  <strong>Review queue</strong>
                  <small>{pending.length} matching requests</small>
                </div>
                <div className={styles.riskFilter}>
                  <span>Risk</span>
                  <SelectMenu
                    ariaLabel="Filter by risk"
                    className={styles.riskSelect}
                    onValueChange={setRisk}
                    options={riskOptions}
                    value={risk}
                  />
                </div>
              </div>
              <div className={styles.queueList}>
                {pending.map((request) => (
                  <button
                    aria-current={
                      request.id === activeSelectedId ? "true" : undefined
                    }
                    className={styles.queueItem}
                    key={request.id}
                    onClick={() => setSelectedId(request.id)}
                    type="button"
                  >
                    <span className="sr-only">
                      Review {request.id}: {request.title}.
                    </span>
                    <span className={styles.requestIcon}>
                      <Icon name={kindIcons[request.kind]} size={17} />
                    </span>
                    <span className={styles.queueCopy}>
                      <span className={styles.queueMeta}>
                        <b>{request.id}</b>
                        <i className={styles[request.risk]}>
                          {titleCase(request.risk)}
                        </i>
                        {!request.canApprove ? (
                          <i className={styles.blocked}>Blocked</i>
                        ) : null}
                      </span>
                      <strong>{request.title}</strong>
                      <small>
                        {request.service} / {request.environment}
                      </small>
                    </span>
                    <span className={styles.queueAge}>
                      <strong>{request.age}</strong>
                      <small>{request.expiresAt}</small>
                    </span>
                    <Icon name="caret-right" size={14} />
                  </button>
                ))}
                {!pending.length ? (
                  <div className={styles.empty}>
                    <Icon name="check-circle" size={22} />
                    <strong>No requests match these filters</strong>
                    <p>
                      Clear search or change the risk filter to review another
                      request.
                    </p>
                    <button
                      onClick={() => {
                        setQuery("")
                        setRisk("all")
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : null}
              </div>
            </section>

            {selected && selected.status === "pending" ? (
              <ApprovalInspector
                onDecision={beginDecision}
                request={selected}
              />
            ) : (
              <section className={styles.inspectorEmpty}>
                <Icon name="shield-check" size={26} />
                <h2>Select a request</h2>
                <p>
                  Inspect scope, evidence, and policy checks before deciding.
                </p>
              </section>
            )}
          </div>
        ) : null}

        {tab === "history" ? (
          <section
            aria-label="Decision history"
            aria-labelledby="safety-tab-history"
            className={styles.history}
            id="safety-panel-history"
            role="tabpanel"
          >
            <header>
              <div>
                <h2>Decision history</h2>
                <p>
                  Every resolved request includes the actor, reason, and final
                  state.
                </p>
              </div>
              <Link className={styles.auditLink} href="/audit">
                <Icon name="file-text" size={15} /> Immutable audit trail
              </Link>
            </header>
            <div className={styles.historyRows}>
              {filteredHistory.map((item) => (
                <article key={item.id}>
                  <span
                    className={`${styles.decisionMark} ${styles[item.decision]}`}
                  >
                    <Icon
                      name={item.decision === "approved" ? "check-circle" : "x"}
                      size={16}
                    />
                  </span>
                  <div>
                    <span>
                      <b>{item.requestId}</b>
                      <i className={styles[item.decision]}>
                        {titleCase(item.decision)}
                      </i>
                    </span>
                    <strong>{item.title}</strong>
                    <p>{item.reason}</p>
                  </div>
                  <span className={styles.historyActor}>
                    <strong>{item.actor}</strong>
                    <small>{item.decidedAt}</small>
                    <small>{item.incidentId}</small>
                  </span>
                </article>
              ))}
              {!filteredHistory.length ? (
                <div className={styles.empty}>
                  <Icon name="magnifying-glass" size={22} />
                  <strong>No decisions match this search</strong>
                  <p>Try a request ID, incident, reviewer, or decision.</p>
                  <button onClick={() => setQuery("")} type="button">
                    Clear search
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "policies" ? (
          <section
            aria-label="Safety policies"
            aria-labelledby="safety-tab-policies"
            className={styles.policies}
            id="safety-panel-policies"
            role="tabpanel"
          >
            <header>
              <h2>Enforced safety policies</h2>
              <p>Presentation cannot bypass these controller-owned checks.</p>
            </header>
            <div>
              {filteredPolicies.map((policy) => (
                <article key={policy.id}>
                  <header>
                    <span className={styles.policyIcon}>
                      <Icon name="shield-check" size={17} />
                    </span>
                    <div>
                      <span>
                        <b>{policy.id}</b>
                        <i>{titleCase(policy.mode)}</i>
                      </span>
                      <h3>{policy.name}</h3>
                    </div>
                  </header>
                  <p>{policy.description}</p>
                  <strong>{policy.coverage}</strong>
                  <ul>
                    {policy.rules.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </article>
              ))}
              {!filteredPolicies.length ? (
                <div className={styles.empty}>
                  <Icon name="magnifying-glass" size={22} />
                  <strong>No policies match this search</strong>
                  <p>Try a policy ID, environment, or enforced rule.</p>
                  <button onClick={() => setQuery("")} type="button">
                    Clear search
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>

      {draft ? (
        <DecisionDialog
          confirmed={confirmed}
          decision={draft.decision}
          error={error}
          onClose={closeDecision}
          onConfirmChange={setConfirmed}
          onReasonChange={setReason}
          onSubmit={submitDecision}
          reason={reason}
          request={view.requests.find((item) => item.id === draft.requestId)!}
          submitting={submitting}
        />
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </main>
  )
}

function ApprovalInspector({
  request,
  onDecision,
}: {
  request: ApprovalRequest
  onDecision: (decision: "approve" | "deny") => void
}) {
  return (
    <section
      className={styles.inspector}
      aria-label={`Approval details for ${request.id}`}
    >
      <header className={styles.inspectorHeader}>
        <div>
          <span>
            <b>{request.id}</b>
            <i className={styles[request.risk]}>
              {titleCase(request.risk)} risk
            </i>
          </span>
          <h2>{request.title}</h2>
          <p>{request.summary}</p>
        </div>
        <span className={styles.requester}>
          <i>{request.requestedBy.initials}</i>
          <span>
            <small>Requested by</small>
            <strong>{request.requestedBy.name}</strong>
          </span>
        </span>
      </header>

      {!request.canApprove ? (
        <div className={styles.policyBlock} role="alert">
          <Icon name="warning-circle" size={17} />
          <span>
            <strong>Approval unavailable</strong>
            <small>{request.blockedReason}</small>
          </span>
        </div>
      ) : null}

      <div className={styles.actionBlock}>
        <span>Requested action</span>
        <code>{request.action}</code>
        <div>
          {request.scope.map((scope) => (
            <span key={scope}>{scope}</span>
          ))}
        </div>
      </div>

      <section className={styles.checks}>
        <header>
          <h3>Policy checks</h3>
          <span>{request.policyId}</span>
        </header>
        <div>
          {request.checks.map((check) => (
            <article key={check.id}>
              <span className={styles[check.status]}>
                <Icon
                  name={
                    check.status === "passed"
                      ? "check-circle"
                      : "warning-circle"
                  }
                  size={16}
                />
              </span>
              <div>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.evidence}>
        <h3>Attached evidence</h3>
        <ul>
          {request.evidence.map((item) => (
            <li key={item}>
              <Icon name="file-text" size={14} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.decisionBar}>
        <span>
          <Icon name="shield-check" size={16} />
          <span>
            <strong>Human decision required</strong>
            <small>No action runs until you confirm.</small>
          </span>
        </span>
        <div>
          <button
            className={styles.denyButton}
            onClick={() => onDecision("deny")}
            type="button"
          >
            Deny
          </button>
          <button
            className={styles.approveButton}
            disabled={!request.canApprove}
            onClick={() => onDecision("approve")}
            type="button"
          >
            Review approval
          </button>
        </div>
      </footer>
    </section>
  )
}

function DecisionDialog({
  request,
  decision,
  reason,
  confirmed,
  submitting,
  error,
  onReasonChange,
  onConfirmChange,
  onClose,
  onSubmit,
}: {
  request: ApprovalRequest
  decision: "approve" | "deny"
  reason: string
  confirmed: boolean
  submitting: boolean
  error: string | null
  onReasonChange: (value: string) => void
  onConfirmChange: (value: boolean) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const approving = decision === "approve"
  const dialogRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea, input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="decision-title"
        aria-modal="true"
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span
            className={
              approving ? styles.dialogApproveIcon : styles.dialogDenyIcon
            }
          >
            <Icon
              name={approving ? "shield-check" : "warning-circle"}
              size={19}
            />
          </span>
          <div>
            <small>
              {request.id} / {request.incidentId}
            </small>
            <h2 id="decision-title">
              {approving ? "Confirm approval" : "Deny request"}
            </h2>
          </div>
          <button
            aria-label="Close decision dialog"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={17} />
          </button>
        </header>
        <div className={styles.dialogBody}>
          <p>
            {approving
              ? "This authorizes the controller to perform only the scoped action below."
              : "The request will be closed without running the proposed action."}
          </p>
          <code>{request.action}</code>
          <label className={styles.reasonField}>
            <span>Decision reason</span>
            <textarea
              aria-label="Decision reason"
              autoFocus
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder={
                approving
                  ? "Why is this action safe to proceed?"
                  : "What must change before resubmission?"
              }
              rows={3}
              value={reason}
            />
            <small>Required. This note is written to the audit trail.</small>
          </label>
          <label className={styles.confirmCheck}>
            <input
              checked={confirmed}
              onChange={(event) => onConfirmChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>
                {approving
                  ? "I reviewed the scope and evidence"
                  : "I understand this closes the request"}
              </strong>
              <small>
                {approving
                  ? "No production or default-branch mutation is authorized."
                  : "The agent must create a new request to proceed."}
              </small>
            </span>
          </label>
          {error ? (
            <div className={styles.dialogError} role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <footer>
          <button onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className={
              approving ? styles.approveButton : styles.confirmDenyButton
            }
            disabled={!confirmed || !reason.trim() || submitting}
            onClick={onSubmit}
            type="button"
          >
            {submitting
              ? "Saving..."
              : approving
                ? "Approve action"
                : "Deny request"}
          </button>
        </footer>
      </section>
    </div>
  )
}
