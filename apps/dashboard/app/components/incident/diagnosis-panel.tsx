"use client"

import { useEffect, useRef } from "react"

import type {
  IncidentDiagnosisViewModel,
  IncidentTab,
} from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

const demoDiagnosis: IncidentDiagnosisViewModel = {
  state: "validated",
  eyebrow: "Evidence stable",
  title: "Working diagnosis",
  summary:
    "A high-cardinality key introduced in v2.8.1 keeps unique checkout payloads alive, increasing heap usage and request latency.",
  probableRootCause: "Unbounded cache key retention",
  confidencePercent: 87,
  confidenceLabel: "High confidence · 5 correlated signals",
  supportingEvidence: [
    {
      id: "metrics",
      title: "Heap reached 94%",
      detail: "4 min after deploy · Verified",
    },
    {
      id: "trace",
      title: "Latency rose to 812ms",
      detail: "Dominant span · High signal",
    },
    {
      id: "code",
      title: "CheckoutCache.set()",
      detail: "Retained heap owner · cache.ts:47",
    },
  ],
  checks: [
    {
      title: "Traffic remained steady",
      detail: "No demand spike before 10:02 AM",
    },
    {
      title: "No configuration drift",
      detail: "Only deploy v2.8.1 changed",
    },
    {
      title: "Instances stayed healthy",
      detail: "No restarts or host pressure",
    },
  ],
  affectedCode: {
    label: "CheckoutCache.set()",
    path: "services/checkout/cache.ts:47",
    evidenceId: "code",
  },
  actionLabel: "Review proposed fix",
}

type DiagnosisPanelProps = {
  compact: boolean
  diagnosis?: IncidentDiagnosisViewModel
  onClose: () => void
  onOpenEvidence: (id: string) => void
  onTabChange: (tab: IncidentTab) => void
  onNotify: (message: string) => void
}

export function DiagnosisPanel({
  compact,
  diagnosis,
  onClose,
  onOpenEvidence,
  onTabChange,
  onNotify,
}: DiagnosisPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const model = diagnosis ?? demoDiagnosis
  const confidence = model.confidencePercent ?? 0

  useEffect(() => {
    if (!compact) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.requestAnimationFrame(() => panelRef.current?.focus())
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      const controls = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button, [href], input, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hasAttribute("disabled"))
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener("keydown", handleKeys)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeys)
      window.requestAnimationFrame(() => previousFocusRef.current?.focus())
    }
  }, [compact, onClose])

  return (
    <>
      <button
        aria-label="Close working diagnosis"
        className="diagnosis-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-labelledby="diagnosis-title"
        aria-modal={compact || undefined}
        className="diagnosis-panel"
        ref={panelRef}
        role={compact ? "dialog" : undefined}
        tabIndex={compact ? -1 : undefined}
      >
        <div className="diagnosis-title-row">
          <div>
            <span className="diagnosis-eyebrow">
              <i /> {model.eyebrow}
            </span>
            <h2 id="diagnosis-title">{model.title}</h2>
          </div>
          <button
            aria-label="Close diagnosis"
            className="icon-button compact"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <section className="diagnosis-summary" aria-label="Probable root cause">
          <div className="diagnosis-summary-heading">
            <span>Probable root cause</span>
            {model.confidencePercent === undefined ? null : (
              <strong>{model.confidencePercent}%</strong>
            )}
          </div>
          <h3>{model.probableRootCause ?? model.title}</h3>
          <p>{model.summary}</p>
          <div className="confidence">
            <progress
              aria-label="Diagnosis confidence"
              max="100"
              value={confidence}
            >
              {confidence}%
            </progress>
            <span>
              {model.confidenceLabel ??
                (model.confidencePercent === undefined
                  ? "Awaiting validated diagnosis"
                  : `${model.confidencePercent}% confidence`)}
            </span>
          </div>
        </section>

        {diagnosis ? null : (
          <div className="confidence-drivers" aria-label="Confidence drivers">
            <span>
              <Icon name="clock" size={14} />
              <b>+31</b>
              <small>Timing</small>
            </span>
            <span>
              <Icon name="chart-line-up" size={14} />
              <b>+28</b>
              <small>Heap</small>
            </span>
            <span>
              <Icon name="activity" size={14} />
              <b>+28</b>
              <small>Trace</small>
            </span>
          </div>
        )}

        <section className="diagnosis-section">
          <div className="section-title-row">
            <div>
              <h3>Supporting evidence</h3>
              <span>
                {model.supportingEvidence.length
                  ? (model.supportingEvidenceLabel ??
                    "Strongest signals in the causal path")
                  : "No diagnosis evidence has been cited yet"}
              </span>
            </div>
            <button
              className="text-link"
              onClick={() => onTabChange("graph")}
              type="button"
            >
              Open graph <Icon name="caret-right" size={13} />
            </button>
          </div>
          <ol className="supporting-evidence">
            {model.supportingEvidence.map((evidence, index) => (
              <li key={evidence.id}>
                <button
                  onClick={() => onOpenEvidence(evidence.id)}
                  type="button"
                >
                  <span className="evidence-rank">{index + 1}</span>
                  <span>
                    <strong>{evidence.title}</strong>
                    <small>{evidence.detail}</small>
                  </span>
                  <Icon name="caret-right" size={14} />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="diagnosis-section assumptions">
          <div className="section-title-row">
            <div>
              <h3>Checks completed</h3>
              <span>{model.checks.length} trusted checks</span>
            </div>
            <span className="verified-count">
              <Icon name="check-circle" size={14} /> {model.checks.length}/
              {model.checks.length}
            </span>
          </div>
          <ul>
            {model.checks.map((check) => (
              <li key={check.title}>
                <Icon name="check-circle" size={15} />
                <span>
                  <strong>{check.title}</strong>
                  <small>{check.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {model.affectedCode ? (
          <section className="diagnosis-section affected-function">
            <div className="section-title-row">
              <div>
                <h3>Affected code</h3>
                <span>Core causal-path owner</span>
              </div>
            </div>
            <div className="affected-code-card">
              <button
                className="affected-code-open"
                onClick={() => onOpenEvidence(model.affectedCode!.evidenceId)}
                type="button"
              >
                <span>
                  <code>{model.affectedCode.label}</code>
                  <small>{model.affectedCode.path}</small>
                </span>
                <Icon name="arrow-square-out" size={15} />
              </button>
              <button
                aria-label="Copy affected function path"
                className="affected-code-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    `${model.affectedCode!.path} — ${model.affectedCode!.label}`,
                  )
                  onNotify("Function path copied")
                }}
                type="button"
              >
                <Icon name="copy" size={16} />
              </button>
            </div>
          </section>
        ) : null}

        <div className="diagnosis-action">
          <button
            className="primary-button"
            onClick={() => {
              onTabChange("changes")
              onNotify("Authorized workflow opened")
            }}
            type="button"
          >
            <Icon name="wrench" size={18} /> {model.actionLabel}{" "}
            <Icon name="caret-right" size={15} />
          </button>
          <small>
            <Icon name="shield-check" size={14} /> Review first · no production
            changes
          </small>
        </div>
      </aside>
    </>
  )
}

export function DiagnosisLauncher({
  compact,
  diagnosis,
  onOpen,
}: {
  compact: boolean
  diagnosis?: IncidentDiagnosisViewModel
  onOpen: () => void
}) {
  return (
    <button
      aria-haspopup={compact ? "dialog" : undefined}
      className="reopen-diagnosis"
      onClick={onOpen}
      type="button"
    >
      <Icon name="graph" size={16} /> {diagnosis?.title ?? "Diagnosis"}
      {diagnosis?.confidencePercent === undefined
        ? ""
        : ` · ${diagnosis.confidencePercent}%`}
    </button>
  )
}
