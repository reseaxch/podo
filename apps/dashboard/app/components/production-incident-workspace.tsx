import type {
  DetectedIncident,
  IncidentEvidence,
  TelemetryKind,
} from "@podo/contracts"

import { Icon } from "./ui/pictogram"

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

function EvidenceCard({ evidence }: { evidence: IncidentEvidence }) {
  return (
    <article className="production-evidence-card">
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

          <aside
            className="production-next-step"
            aria-labelledby="next-step-title"
          >
            <Icon name="shield-check" size={24} />
            <p className="production-kicker">Fail-closed boundary</p>
            <h2 id="next-step-title">Investigation not started</h2>
            <p>
              Core has detected the incident and attached telemetry evidence.
              Diagnosis, approval, remediation, and pull-request controls remain
              unavailable until core exposes an incident-linked investigation.
            </p>
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
          </aside>
        </div>
      </section>
    </main>
  )
}
