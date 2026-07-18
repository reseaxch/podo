"use client"

import { useState } from "react"

import type {
  IncidentController,
  IncidentWorkflowCommand,
  IncidentWorkflowViewModel,
} from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

function nextActions(workflow: IncidentWorkflowViewModel): Array<{
  label: string
  tone: "primary" | "secondary"
  command: IncidentWorkflowCommand
}> {
  const { delivery, issueDelivery, remediation } = workflow
  if (issueDelivery || delivery?.status === "delivered") return []
  if (!workflow.incident.investigation)
    return [
      {
        label: "Investigate incident",
        tone: "primary",
        command: { action: "start-investigation" },
      },
    ]
  if (!remediation) {
    const diagnosis = workflow.incident.diagnosis
    if (diagnosis?.status !== "validated") return []
    return [
      {
        label: diagnosis.safeToAttemptFix
          ? "Prepare tested remediation"
          : "Create GitHub issue",
        tone: "primary",
        command: diagnosis.safeToAttemptFix
          ? { action: "start-remediation" }
          : { action: "start-issue" },
      },
    ]
  }
  if (remediation.status === "pending_approval")
    return [
      {
        label: "Deny remediation",
        tone: "secondary",
        command: {
          action: "decide-remediation",
          approvalId: remediation.approval.id,
          decision: "deny",
        },
      },
      {
        label: "Approve tested remediation",
        tone: "primary",
        command: {
          action: "decide-remediation",
          approvalId: remediation.approval.id,
          decision: "approve",
        },
      },
    ]
  if (remediation.status === "completed" && !delivery)
    return [
      {
        label: "Prepare pull request",
        tone: "primary",
        command: { action: "start-delivery" },
      },
    ]
  if (delivery?.status === "pending_approval")
    return [
      {
        label: "Deny delivery",
        tone: "secondary",
        command: {
          action: "decide-delivery",
          approvalId: delivery.approval.id,
          decision: "deny",
        },
      },
      {
        label: "Approve & create PR",
        tone: "primary",
        command: {
          action: "decide-delivery",
          approvalId: delivery.approval.id,
          decision: "approve",
        },
      },
    ]
  if (remediation.status === "failed" || remediation.status === "denied")
    return [
      {
        label: "Create GitHub issue",
        tone: "primary",
        command: { action: "start-issue" },
      },
    ]
  return []
}

export function CoreChangesView({
  controller,
  incidentId,
  onNotify,
  workflow,
}: {
  controller: IncidentController
  incidentId: string
  onNotify: (message: string) => void
  workflow: IncidentWorkflowViewModel
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { delivery, issueDelivery, remediation } = workflow
  const artifact = remediation?.artifact
  const actions = nextActions(workflow)
  const processing =
    remediation?.status === "running" ||
    delivery?.status === "delivering" ||
    issueDelivery?.status === "creating"

  async function execute(command: IncidentWorkflowCommand) {
    if (!controller.executeWorkflow) return
    setPending(true)
    setError(null)
    try {
      await controller.executeWorkflow(command)
      onNotify("Core workflow updated")
    } catch (commandError) {
      const message =
        commandError instanceof Error ? commandError.message : "Action failed"
      setError(message)
      onNotify(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="changes-view" aria-labelledby="changes-heading">
      <div className="view-heading changes-heading">
        <div>
          <p className="view-kicker">Core-owned remediation workflow</p>
          <h2 id="changes-heading">
            {artifact?.patch.summary ?? "No tested remediation yet"}
          </h2>
          <p>
            {artifact
              ? "The exact patch below passed the Core red-to-green regression and validation gates."
              : "Investigation, remediation, and pull-request delivery remain behind explicit Core approvals."}
          </p>
        </div>
        <div className="view-actions">
          <span
            className={`status-chip state-${
              delivery?.status === "delivered"
                ? "approved"
                : remediation?.status === "failed"
                  ? "changes-requested"
                  : "ready"
            }`}
          >
            {delivery?.status === "delivered"
              ? "PR created"
              : (remediation?.status ?? "Awaiting remediation")}
          </span>
        </div>
      </div>

      <section
        className="remediation-timeline timeline-ready"
        aria-label="Incident to pull request progress"
      >
        <header>
          <span>
            <small>Evidence-backed workflow</small>
            <strong>Incident → tested fix → pull request</strong>
          </span>
          <em>Live Core state</em>
        </header>
        <div className="remediation-trace" role="list">
          {[
            ["Incident detected", true],
            ["Diagnosis validated", Boolean(remediation)],
            ["Fix verified", Boolean(artifact)],
            ["Delivery approved", delivery?.approval.status === "approved"],
            ["Pull request", delivery?.status === "delivered"],
          ].map(([label, complete]) => (
            <article
              className={`trace-stage trace-stage-${complete ? "complete" : "pending"}`}
              key={String(label)}
              role="listitem"
            >
              <span className="trace-node">
                <Icon name={complete ? "check-circle" : "clock"} size={15} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{complete ? "Complete" : "Awaiting Core state"}</small>
              </span>
            </article>
          ))}
        </div>
      </section>

      {artifact ? (
        <>
          <div className="remediation-summary">
            <span>
              <small>Patch scope</small>
              <strong>{artifact.patch.changedFiles.length} files</strong>
              <em>Exact verified tree</em>
            </span>
            <span>
              <small>Regression</small>
              <strong>
                {artifact.regression.prePatch} → {artifact.regression.postPatch}
              </strong>
              <em className="passed">Red-to-green proven</em>
            </span>
            <span>
              <small>Validation</small>
              <strong>{artifact.validation.checks.length} checks</strong>
              <em className="passed">{artifact.validation.status}</em>
            </span>
            <span>
              <small>Result tree</small>
              <strong>{artifact.provenance.resultTreeOid.slice(0, 10)}</strong>
              <em>Sealed by Core</em>
            </span>
          </div>
          <div className="remediation-workspace">
            <section className="diff-panel" aria-labelledby="diff-title">
              <header>
                <div>
                  <Icon name="git-diff" size={18} />
                  <span>
                    <strong id="diff-title">Verified patch</strong>
                    <small>{artifact.patch.changedFiles.join(" · ")}</small>
                  </span>
                </div>
              </header>
              <pre className="diff-code" aria-label="Verified code diff">
                <code>{artifact.patch.unifiedDiff}</code>
              </pre>
            </section>
            <aside className="verification-panel">
              <header>
                <Icon name="shield-check" size={18} />
                <span>
                  <strong>Review readiness</strong>
                  <small>Verified in isolated checkout</small>
                </span>
                <b className="readiness-score">
                  {artifact.validation.checks.length}/
                  {artifact.validation.checks.length}
                </b>
              </header>
              <section>
                <div className="verification-title">
                  <span>
                    <Icon name="check-circle" size={17} /> Automated checks
                  </span>
                  <strong>Passed</strong>
                </div>
                <ul>
                  {artifact.validation.checks.map((check) => (
                    <li key={check}>
                      <span>{check}</span>
                      <b>passed</b>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="safety-note">
                <Icon name="shield-check" size={17} />
                <span>
                  <strong>Safe approval boundary</strong>
                  <small>
                    Approval creates a PR only. It cannot deploy or mutate
                    production.
                  </small>
                </span>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <section className="change-rationale" aria-label="Workflow state">
          <span className="rationale-icon">
            <Icon name="shield-check" size={18} />
          </span>
          <span>
            <small>Current Core state</small>
            <strong>
              {processing
                ? "Core is processing the authorized step"
                : "No verified patch is available for review"}
            </strong>
            <p>
              The UI will populate the diff and validation results only after
              Core returns a sealed remediation artifact.
            </p>
          </span>
        </section>
      )}

      {error ? (
        <p className="production-workflow-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="approval-bar approval-ready">
        <span>
          <Icon name="git-branch" size={18} />
          <span>
            <strong>
              {processing ? "Core is processing" : "Next authorized action"}
            </strong>
            <small>{incidentId}</small>
          </span>
        </span>
        <div>
          {delivery?.status === "delivered" && delivery.pullRequest ? (
            <a
              className="primary-button"
              href={delivery.pullRequest.url}
              rel="noreferrer"
              target="_blank"
            >
              <Icon name="arrow-square-out" size={16} /> Open PR #
              {delivery.pullRequest.number}
            </a>
          ) : issueDelivery?.status === "created" && issueDelivery.issue ? (
            <a
              className="primary-button"
              href={issueDelivery.issue.url}
              rel="noreferrer"
              target="_blank"
            >
              <Icon name="arrow-square-out" size={16} /> Open issue #
              {issueDelivery.issue.number}
            </a>
          ) : (
            actions.map(({ command, label, tone }) => (
              <button
                className={
                  tone === "primary"
                    ? "primary-button motion-border-cta"
                    : "secondary-button"
                }
                disabled={pending || processing}
                key={label}
                onClick={() => void execute(command)}
                type="button"
              >
                {label}
              </button>
            ))
          )}
        </div>
      </footer>
    </section>
  )
}
