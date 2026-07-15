import type {
  DetectedIncident,
  IncidentEvidence,
  TelemetryKind,
} from "@podo/contracts"

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
          No incident-linked investigation exists. Start one through an
          authorized Podo client; this production dashboard remains read-only.
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
          Core owns the investigation lifecycle. This dashboard reports its
          authoritative state without offering local approval or remediation
          controls.
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

export function ProductionIncidentWorkspace({
  incident,
}: {
  incident: DetectedIncident
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

          <InvestigationPanel incident={incident} />
        </div>
      </section>
    </main>
  )
}
