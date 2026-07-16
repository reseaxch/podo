"use client"

import type {
  DetectedIncident,
  IncidentCausalPath,
  IncidentDelivery,
  IncidentEvidence,
  IncidentIssueDelivery,
  IncidentRemediation,
  TelemetryKind,
} from "@podo/contracts"
import { useCallback, useEffect, useState } from "react"

import { Icon } from "./ui/pictogram"

type ValidatedDiagnosis = Extract<
  NonNullable<DetectedIncident["diagnosis"]>,
  { status: "validated" }
>

const sourceLabels: Record<TelemetryKind, string> = {
  log: "Log",
  metric: "Metric",
  trace: "Trace",
}

const sourceIcons: Record<
  TelemetryKind,
  "activity" | "chart-line-up" | "cube" | "file-text"
> = {
  log: "file-text",
  metric: "chart-line-up",
  trace: "activity",
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))
}

function formatConfidence(value: number): string {
  return `${(value / 100).toFixed(2)}% confidence`
}

function EvidenceCard({ evidence }: { evidence: IncidentEvidence }) {
  return (
    <article
      className="production-evidence-card"
      id={`evidence-${evidence.id}`}
    >
      <div className="production-evidence-icon">
        <Icon name={sourceIcons[evidence.sourceType]} size={19} />
      </div>
      <div>
        <div className="production-evidence-heading">
          <strong>{sourceLabels[evidence.sourceType]}</strong>
          <span className="production-verified">
            <Icon name="check-circle" size={15} /> Core evidence
          </span>
        </div>
        <time dateTime={evidence.observedAt}>
          {formatInstant(evidence.observedAt)} UTC
        </time>
        <dl className="production-evidence-facts">
          <div>
            <dt>Source event</dt>
            <dd>{evidence.sourceEventId}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>{evidence.service}</dd>
          </div>
          <div>
            <dt>Deployment</dt>
            <dd>{evidence.deploymentId}</dd>
          </div>
          <div>
            <dt>Evidence ID</dt>
            <dd>{evidence.id}</dd>
          </div>
        </dl>
      </div>
    </article>
  )
}

function IncidentFacts({ incident }: { incident: DetectedIncident }) {
  return (
    <dl>
      <div>
        <dt>Detector</dt>
        <dd>{incident.detector}</dd>
      </div>
      <div>
        <dt>Incident ID</dt>
        <dd>{incident.id}</dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd>{formatInstant(incident.createdAt)} UTC</dd>
      </div>
    </dl>
  )
}

function CausalPath({ path }: { path: IncidentCausalPath }) {
  const nodes = [
    { label: "Telemetry", value: path.telemetryEvent.id },
    { label: "Container", value: path.container.id },
    { label: "Deployment", value: path.deployment.id },
    { label: "Commit", value: path.commit.sha },
    { label: "File", value: path.file.location?.path ?? path.file.label },
    { label: "Function", value: path.function.label },
  ]
  return (
    <section className="production-causal-path" aria-labelledby="causal-title">
      <header>
        <div>
          <p className="production-kicker">Causal graph</p>
          <h2 id="causal-title">Evidence to code</h2>
        </div>
        <span>Core graph</span>
      </header>
      <ol>
        {nodes.map((node) => (
          <li key={node.label}>
            <span>{node.label}</span>
            <strong>{node.value}</strong>
          </li>
        ))}
      </ol>
    </section>
  )
}

function DiagnosisUnavailable({
  incident,
  message,
}: {
  incident: DetectedIncident
  message: string
}) {
  return (
    <aside
      className="production-next-step"
      data-state="failed"
      aria-labelledby="next-step-title"
    >
      <Icon name="warning-circle" size={24} />
      <p className="production-kicker">Fail-closed boundary</p>
      <h2 id="next-step-title">Diagnosis unavailable</h2>
      <p>{message}</p>
      <IncidentFacts incident={incident} />
    </aside>
  )
}

function ValidatedDiagnosisPanel({
  diagnosis,
  evidence,
}: {
  diagnosis: ValidatedDiagnosis
  evidence: IncidentEvidence[]
}) {
  return (
    <aside
      className="production-next-step production-diagnosis"
      data-state="validated"
      aria-labelledby="next-step-title"
    >
      <Icon name="shield-check" size={24} />
      <p className="production-kicker">Validated diagnosis</p>
      <h2 id="next-step-title">Evidence-backed diagnosis</h2>
      <p>{diagnosis.summary}</p>

      <section className="production-diagnosis-section">
        <h3>Probable root cause</h3>
        <p>{diagnosis.probableRootCause}</p>
      </section>

      <dl className="production-diagnosis-facts">
        <div>
          <dt>Confidence</dt>
          <dd>{formatConfidence(diagnosis.confidence.value)}</dd>
        </div>
        <div>
          <dt>Recommended action</dt>
          <dd>{diagnosis.recommendedAction}</dd>
        </div>
      </dl>

      <section
        className="production-diagnosis-evidence"
        aria-labelledby="diagnosis-evidence-title"
      >
        <h3 id="diagnosis-evidence-title">Cited core evidence</h3>
        <ul>
          {evidence.map((item) => (
            <li key={item.id}>
              <a href={`#evidence-${item.id}`}>{item.id}</a>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

function InvestigationPanel({ incident }: { incident: DetectedIncident }) {
  const investigation = incident.investigation
  const diagnosis = incident.diagnosis

  if (diagnosis?.status === "failed") {
    return (
      <DiagnosisUnavailable
        incident={incident}
        message={diagnosis.error.message}
      />
    )
  }

  if (diagnosis?.status === "validated") {
    const evidenceById = new Map(
      incident.evidence.map((item) => [item.id, item]),
    )
    const citedEvidence = diagnosis.evidenceIds.map((id) =>
      evidenceById.get(id),
    )

    if (
      investigation?.status === "completed" &&
      citedEvidence.every(
        (item): item is IncidentEvidence => item !== undefined,
      )
    ) {
      return (
        <ValidatedDiagnosisPanel
          diagnosis={diagnosis}
          evidence={citedEvidence}
        />
      )
    }

    return (
      <DiagnosisUnavailable
        incident={incident}
        message="The incident lifecycle response is incomplete, so Podo will not expose diagnosis or remediation guidance."
      />
    )
  }

  if (!investigation) {
    return (
      <aside
        className="production-next-step"
        data-state="not-started"
        aria-labelledby="next-step-title"
      >
        <Icon name="shield-check" size={24} />
        <p className="production-kicker">Fail-closed boundary</p>
        <h2 id="next-step-title">Investigation not started</h2>
        <p>
          No incident-linked investigation exists. Start one below through the
          Core-owned, read-only investigation boundary.
        </p>
        <IncidentFacts incident={incident} />
      </aside>
    )
  }

  const activeHeadings = {
    starting: "Investigation starting",
    running: "Investigation running",
    waiting_for_approval: "Investigation waiting for approval",
  } as const

  if (investigation.status in activeHeadings) {
    const status = investigation.status as keyof typeof activeHeadings

    return (
      <aside
        className="production-next-step"
        data-state="active"
        aria-labelledby="next-step-title"
      >
        <Icon name="activity" size={24} />
        <p className="production-kicker">Core investigation</p>
        <h2 id="next-step-title">{activeHeadings[status]}</h2>
        <p>
          Core owns the investigation lifecycle. This dashboard polls its
          authoritative state and exposes only explicit, policy-gated actions.
        </p>
        <dl>
          <div>
            <dt>Investigation ID</dt>
            <dd>{investigation.id}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatInstant(investigation.updatedAt)} UTC</dd>
          </div>
        </dl>
      </aside>
    )
  }

  return (
    <DiagnosisUnavailable
      incident={incident}
      message="The incident lifecycle response is incomplete, so Podo will not expose diagnosis or remediation guidance."
    />
  )
}

type WorkflowState = {
  incident: DetectedIncident
  remediation: IncidentRemediation | null
  delivery: IncidentDelivery | null
  issueDelivery: IncidentIssueDelivery | null
}

function ProductionWorkflow({ initial }: { initial: WorkflowState }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active =
    state.incident.investigation?.status === "starting" ||
    state.incident.investigation?.status === "running" ||
    state.remediation?.status === "running" ||
    state.delivery?.status === "delivering" ||
    state.issueDelivery?.status === "creating"

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/podo/incidents/${encodeURIComponent(state.incident.id)}`,
      {
        cache: "no-store",
      },
    )
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`)
    setState((await response.json()) as WorkflowState)
  }, [state.incident.id])

  async function command(input: Record<string, string>) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/podo/incidents/${encodeURIComponent(state.incident.id)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      )
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(detail?.message ?? `Action failed (${response.status})`)
      }
      await refresh()
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Action failed",
      )
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  const diagnosis = state.incident.diagnosis
  const trustedDiagnosis =
    diagnosis?.status === "validated" &&
    state.incident.investigation?.status === "completed" &&
    diagnosis.evidenceIds.every((id) =>
      state.incident.evidence.some((item) => item.id === id),
    )
  const remediation = state.remediation
  const delivery = state.delivery
  const issueDelivery = state.issueDelivery

  return (
    <div className="production-workflow-column">
      <InvestigationPanel incident={state.incident} />
      <section className="production-workflow" aria-labelledby="workflow-title">
        <header>
          <div>
            <p className="production-kicker">Authorized workflow</p>
            <h2 id="workflow-title">Next safe action</h2>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void refresh().catch((refreshError) =>
                setError(String(refreshError)),
              )
            }
            type="button"
          >
            Refresh
          </button>
        </header>

        {error ? (
          <p className="production-workflow-error" role="alert">
            {error}
          </p>
        ) : null}

        {remediation?.artifact ? (
          <section
            className="production-artifact"
            aria-label="Verified remediation artifact"
          >
            <div>
              <strong>{remediation.artifact.patch.summary}</strong>
              <span>
                {remediation.artifact.patch.changedFiles.length} changed files ·
                verified tree {remediation.artifact.provenance.resultTreeOid}
              </span>
            </div>
            <dl>
              <div>
                <dt>Regression before patch</dt>
                <dd className="failed">
                  {remediation.artifact.regression.prePatch}
                </dd>
              </div>
              <div>
                <dt>Regression after patch</dt>
                <dd className="passed">
                  {remediation.artifact.regression.postPatch}
                </dd>
              </div>
              <div>
                <dt>Validation</dt>
                <dd className="passed">
                  {remediation.artifact.validation.status}
                </dd>
              </div>
            </dl>
            <details>
              <summary>Review exact patch</summary>
              <pre>
                <code>{remediation.artifact.patch.unifiedDiff}</code>
              </pre>
            </details>
          </section>
        ) : null}

        {issueDelivery?.status === "created" && issueDelivery.issue ? (
          <a
            className="primary-button"
            href={issueDelivery.issue.url}
            rel="noreferrer"
            target="_blank"
          >
            Open issue #{issueDelivery.issue.number}
          </a>
        ) : issueDelivery?.status === "failed" ? (
          <p className="production-workflow-error" role="alert">
            {issueDelivery.error?.message ?? "GitHub issue delivery failed."}
          </p>
        ) : delivery?.status === "delivered" && delivery.pullRequest ? (
          <a
            className="primary-button"
            href={delivery.pullRequest.url}
            rel="noreferrer"
            target="_blank"
          >
            Open PR #{delivery.pullRequest.number}
          </a>
        ) : delivery?.status === "failed" ? (
          <p className="production-workflow-error" role="alert">
            {delivery.error?.message ?? "Pull request delivery failed."}
          </p>
        ) : remediation?.status === "failed" ? (
          <div>
            <p className="production-workflow-error" role="alert">
              {remediation.error?.message ?? "Remediation verification failed."}
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void command({ action: "start-issue" })}
              type="button"
            >
              Create GitHub issue
            </button>
          </div>
        ) : !state.incident.investigation ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void command({ action: "start-investigation" })}
            type="button"
          >
            Investigate incident
          </button>
        ) : active ? (
          <p className="production-workflow-status" role="status">
            <Icon name="activity" size={16} /> Core is processing this step…
          </p>
        ) : diagnosis?.status === "failed" ? (
          <p className="production-workflow-status">
            Investigation failed closed. Review the audit trail before retrying.
          </p>
        ) : trustedDiagnosis && !diagnosis.safeToAttemptFix && !remediation ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void command({ action: "start-issue" })}
            type="button"
          >
            Create GitHub issue
          </button>
        ) : trustedDiagnosis && diagnosis.safeToAttemptFix && !remediation ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void command({ action: "start-remediation" })}
            type="button"
          >
            Prepare tested remediation
          </button>
        ) : remediation?.status === "pending_approval" ? (
          <div className="production-workflow-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void command({
                  action: "decide-remediation",
                  approvalId: remediation.approval.id,
                  decision: "deny",
                })
              }
              type="button"
            >
              Deny remediation
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void command({
                  action: "decide-remediation",
                  approvalId: remediation.approval.id,
                  decision: "approve",
                })
              }
              type="button"
            >
              Approve tested fix
            </button>
          </div>
        ) : remediation?.status === "denied" ? (
          <div>
            <p className="production-workflow-status">
              Remediation was denied. No code was changed.
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void command({ action: "start-issue" })}
              type="button"
            >
              Create GitHub issue
            </button>
          </div>
        ) : remediation?.status === "completed" && !delivery ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void command({ action: "start-delivery" })}
            type="button"
          >
            Prepare pull request delivery
          </button>
        ) : delivery?.status === "pending_approval" ? (
          <div className="production-workflow-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void command({
                  action: "decide-delivery",
                  approvalId: delivery.approval.id,
                  decision: "deny",
                })
              }
              type="button"
            >
              Deny delivery
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void command({
                  action: "decide-delivery",
                  approvalId: delivery.approval.id,
                  decision: "approve",
                })
              }
              type="button"
            >
              Approve &amp; create PR
            </button>
          </div>
        ) : (
          <p className="production-workflow-status">
            No further action is currently authorized.
          </p>
        )}
      </section>
    </div>
  )
}

export function ProductionIncidentWorkspace({
  incident,
  causalPath = null,
  remediation = null,
  delivery = null,
  issueDelivery = null,
}: {
  incident: DetectedIncident
  causalPath?: IncidentCausalPath | null
  remediation?: IncidentRemediation | null
  delivery?: IncidentDelivery | null
  issueDelivery?: IncidentIssueDelivery | null
}) {
  return (
    <main className="production-shell" data-ready="true">
      <header className="production-topbar">
        <a aria-label="Podo home" className="brand-mark" href="#incident">
          <Icon name="cube" size={21} />
        </a>
        <div>
          <strong>Podo</strong>
          <span>Live core data</span>
        </div>
        <span className="production-connection">
          <i /> Connected to core
        </span>
      </header>

      <section className="production-workspace" id="incident">
        <header className="production-incident-header">
          <div>
            <p className="production-kicker">Detected incident</p>
            <h1>Cache growth detected in {incident.affectedService}</h1>
            <div className="production-meta">
              <span>
                <Icon name="cube" size={16} /> {incident.deploymentId}
              </span>
              <span>
                <Icon name="clock" size={16} /> Updated{" "}
                {formatInstant(incident.updatedAt)} UTC
              </span>
            </div>
          </div>
          <span className="production-status">
            <i /> Detected
          </span>
        </header>

        <div className="production-layout">
          <section
            className="production-evidence"
            aria-labelledby="evidence-title"
          >
            <header>
              <div>
                <p className="production-kicker">Evidence</p>
                <h2 id="evidence-title">Core evidence records</h2>
              </div>
              <span>{incident.evidence.length} records</span>
            </header>
            <div className="production-evidence-list">
              {incident.evidence.map((evidence) => (
                <EvidenceCard evidence={evidence} key={evidence.id} />
              ))}
            </div>
          </section>

          {causalPath ? <CausalPath path={causalPath} /> : null}

          <ProductionWorkflow
            initial={{ incident, remediation, delivery, issueDelivery }}
          />
        </div>
      </section>
    </main>
  )
}
