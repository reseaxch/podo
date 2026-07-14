"use client"

import { useEffect, useRef } from "react"

import type { IncidentTab } from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

type DiagnosisPanelProps = {
  compact: boolean
  onClose: () => void
  onOpenEvidence: (id: string) => void
  onTabChange: (tab: IncidentTab) => void
  onNotify: (message: string) => void
}

export function DiagnosisPanel({
  compact,
  onClose,
  onOpenEvidence,
  onTabChange,
  onNotify,
}: DiagnosisPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

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
              <i /> Evidence stable
            </span>
            <h2 id="diagnosis-title">Working diagnosis</h2>
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
            <strong>87%</strong>
          </div>
          <h3>Unbounded cache key retention</h3>
          <p>
            A high-cardinality key introduced in v2.8.1 keeps unique checkout
            payloads alive, increasing heap usage and request latency.
          </p>
          <div className="confidence">
            <progress aria-label="Diagnosis confidence" max="100" value="87">
              87%
            </progress>
            <span>High confidence · 5 correlated signals</span>
          </div>
        </section>
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
        <section className="diagnosis-section">
          <div className="section-title-row">
            <div>
              <h3>Supporting evidence</h3>
              <span>Strongest signals in the causal path</span>
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
            <li>
              <button onClick={() => onOpenEvidence("metrics")} type="button">
                <span className="evidence-rank">1</span>
                <span>
                  <strong>Heap reached 94%</strong>
                  <small>4 min after deploy · Verified</small>
                </span>
                <Icon name="caret-right" size={14} />
              </button>
            </li>
            <li>
              <button onClick={() => onOpenEvidence("trace")} type="button">
                <span className="evidence-rank">2</span>
                <span>
                  <strong>Latency rose to 812ms</strong>
                  <small>Dominant span · High signal</small>
                </span>
                <Icon name="caret-right" size={14} />
              </button>
            </li>
            <li>
              <button onClick={() => onOpenEvidence("code")} type="button">
                <span className="evidence-rank">3</span>
                <span>
                  <strong>CheckoutCache.set()</strong>
                  <small>Retained heap owner · cache.ts:47</small>
                </span>
                <Icon name="caret-right" size={14} />
              </button>
            </li>
          </ol>
        </section>
        <section className="diagnosis-section assumptions">
          <div className="section-title-row">
            <div>
              <h3>Checks completed</h3>
              <span>3 conditions ruled out</span>
            </div>
            <span className="verified-count">
              <Icon name="check-circle" size={14} /> 3/3
            </span>
          </div>
          <ul>
            <li>
              <Icon name="check-circle" size={15} />
              <span>
                <strong>Traffic remained steady</strong>
                <small>No demand spike before 10:02 AM</small>
              </span>
            </li>
            <li>
              <Icon name="check-circle" size={15} />
              <span>
                <strong>No configuration drift</strong>
                <small>Only deploy v2.8.1 changed</small>
              </span>
            </li>
            <li>
              <Icon name="check-circle" size={15} />
              <span>
                <strong>Instances stayed healthy</strong>
                <small>No restarts or host pressure</small>
              </span>
            </li>
          </ul>
        </section>
        <section className="diagnosis-section affected-function">
          <div className="section-title-row">
            <div>
              <h3>Affected code</h3>
              <span>Dominant retained-heap owner</span>
            </div>
          </div>
          <div className="affected-code-card">
            <button
              className="affected-code-open"
              onClick={() => onOpenEvidence("code")}
              type="button"
            >
              <span>
                <code>CheckoutCache.set()</code>
                <small>services/checkout/cache.ts:47</small>
              </span>
              <Icon name="arrow-square-out" size={15} />
            </button>
            <button
              aria-label="Copy affected function path"
              className="affected-code-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  "services/checkout/cache.ts:47 — CheckoutCache.set()",
                )
                onNotify("Function path copied")
              }}
              type="button"
            >
              <Icon name="copy" size={16} />
            </button>
          </div>
        </section>
        <div className="diagnosis-action">
          <button
            className="primary-button"
            onClick={() => {
              onTabChange("changes")
              onNotify("Proposed remediation opened")
            }}
            type="button"
          >
            <Icon name="wrench" size={18} /> Review proposed fix{" "}
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
  onOpen,
}: {
  compact: boolean
  onOpen: () => void
}) {
  return (
    <button
      aria-haspopup={compact ? "dialog" : undefined}
      className="reopen-diagnosis"
      onClick={onOpen}
      type="button"
    >
      <Icon name="graph" size={16} /> Diagnosis · 87%
    </button>
  )
}
