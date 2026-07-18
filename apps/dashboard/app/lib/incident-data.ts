import type { PodoClient, PodoIncidentClient } from "@podo/client"
import type {
  DetectedIncident,
  IncidentCausalPath,
  IncidentDelivery,
  IncidentEvidenceRecord,
  IncidentIssueDelivery,
  IncidentRemediation,
  TelemetryKind,
} from "@podo/contracts"

import { incidentMock } from "../mocks/incident"

import type {
  Evidence,
  IncidentDiagnosisViewModel,
  IncidentGraphViewModel,
  IncidentStatus,
  IncidentWorkspaceViewModel,
  IncidentWorkflowViewModel,
} from "./incident-types"
import { createDashboardClient } from "./dashboard-client"

type GetIncidentWorkspaceOptions = {
  client?: PodoClient
  incidentId?: string
}

export function getDemoIncidentWorkspace(): IncidentWorkspaceViewModel {
  return structuredClone(incidentMock)
}

export async function getIncidentWorkspace(
  options: GetIncidentWorkspaceOptions = {},
): Promise<DetectedIncident | null> {
  const client = options.client ?? createDashboardClient()
  if (options.incidentId) {
    const { incident } = await client.getIncident(options.incidentId)
    return incident
  }

  const { incidents } = await client.listIncidents()
  return (
    incidents.toSorted((left, right) => {
      const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt)
      return byUpdatedAt || right.id.localeCompare(left.id)
    })[0] ?? null
  )
}

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return null
    throw error
  }
}

export async function getIncidentWorkflow(
  incidentId: string,
  client = createDashboardClient(),
): Promise<{
  remediation: IncidentRemediation | null
  delivery: IncidentDelivery | null
  issueDelivery: IncidentIssueDelivery | null
}> {
  const [remediation, delivery, issueDelivery] = await Promise.all([
    optional(() => client.getIncidentRemediation(incidentId)),
    optional(() => client.getIncidentDelivery(incidentId)),
    optional(() => client.getIncidentIssue(incidentId)),
  ])
  return {
    remediation: remediation?.remediation ?? null,
    delivery: delivery?.delivery ?? null,
    issueDelivery: issueDelivery?.issueDelivery ?? null,
  }
}

export async function getIncidentEvidenceRecords(
  incidentId: string,
  client: PodoIncidentClient = createDashboardClient(),
): Promise<IncidentEvidenceRecord[]> {
  return (await client.getIncidentEvidence(incidentId)).records
}

export async function getIncidentCausalPath(
  incident: DetectedIncident,
  client: PodoIncidentClient = createDashboardClient(),
): Promise<IncidentCausalPath | null> {
  const evidence = incident.evidence[0]
  if (!evidence) return null
  const result = await optional(() =>
    client.getIncidentCausalPath(incident.id, evidence.id),
  )
  return result?.causalPath ?? null
}

const evidenceIcons: Record<
  TelemetryKind,
  "activity" | "chart-line-up" | "file-text"
> = {
  log: "file-text",
  metric: "chart-line-up",
  trace: "activity",
}

const evidenceSources: Record<TelemetryKind, string> = {
  log: "Runtime log",
  metric: "Metric",
  trace: "Trace",
}

function formatEvidenceValue(record: IncidentEvidenceRecord): string {
  const metric = record.event.metric
  if (!metric) return `${record.event.severity.toUpperCase()} telemetry event`
  if (metric.unit === "By")
    return `${metric.name}: ${(metric.value / (1024 * 1024)).toFixed(0)} MiB`
  return `${metric.name}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`
}

function formatDuration(start: string, end: string): string {
  const milliseconds = Math.max(0, Date.parse(end) - Date.parse(start))
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes > 0) return `${minutes} min`
  return `${Math.max(1, Math.ceil(milliseconds / 1_000))} sec`
}

function toEvidence(record: IncidentEvidenceRecord): Evidence {
  const instant = new Date(record.event.timestamp)
  const identifiers = [
    record.event.traceId ? `Trace ${record.event.traceId}` : null,
    record.event.containerId ? `Container ${record.event.containerId}` : null,
    record.event.commitId ? `Commit ${record.event.commitId}` : null,
  ].filter((value): value is string => value !== null)
  return {
    id: record.evidence.id,
    time: new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(instant),
    date: new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(instant),
    icon: evidenceIcons[record.event.kind],
    source: evidenceSources[record.event.kind],
    provider: "OpenTelemetry",
    finding: record.event.message,
    detail: formatEvidenceValue(record),
    ...(identifiers.length ? { meta: identifiers.join(" · ") } : {}),
    validation: "Verified",
    facts: [
      {
        label: "Evidence",
        value: record.evidence.id,
        note: `Source event ${record.event.id}`,
      },
      {
        label: "Service",
        value: record.event.service,
        note: `Deployment ${record.evidence.deploymentId}`,
      },
      ...(record.event.metric
        ? [
            {
              label: "Metric",
              value: record.event.metric.name,
              note: formatEvidenceValue(record),
            },
          ]
        : []),
      ...(record.event.traceId
        ? [
            {
              label: "Trace",
              value: record.event.traceId,
              note: record.event.message,
            },
          ]
        : []),
    ],
  }
}

function toDiagnosis(
  incident: DetectedIncident,
  evidence: Evidence[],
  causalPath: IncidentCausalPath | null,
): IncidentDiagnosisViewModel {
  const diagnosis = incident.diagnosis
  const evidenceById = new Map(evidence.map((item) => [item.id, item]))
  const affectedCode = causalPath
    ? {
        label: causalPath.function.label,
        path: `${causalPath.file.location?.path ?? causalPath.file.label}${
          causalPath.function.location?.line
            ? `:${causalPath.function.location.line}`
            : ""
        }`,
        evidenceId: causalPath.evidence.id,
      }
    : undefined

  if (diagnosis?.status === "validated")
    return {
      state: "validated",
      eyebrow: "Core diagnosis validated",
      title: "Working diagnosis",
      summary: diagnosis.summary,
      probableRootCause: diagnosis.probableRootCause,
      confidencePercent: Math.round(diagnosis.confidence.value / 100),
      confidenceLabel: `${diagnosis.evidenceIds.length} cited Core evidence records`,
      supportingEvidence: diagnosis.evidenceIds.flatMap((id) => {
        const item = evidenceById.get(id)
        return item ? [{ id, title: item.finding, detail: item.detail }] : []
      }),
      checks: [
        {
          title: "Evidence references resolved",
          detail: `${diagnosis.evidenceIds.length}/${diagnosis.evidenceIds.length} citations belong to this incident`,
        },
        {
          title: "Service binding verified",
          detail: diagnosis.affectedService,
        },
        {
          title: "Mutation remains approval-gated",
          detail: diagnosis.safeToAttemptFix
            ? "Fix may be prepared only after explicit approval"
            : "No code remediation is authorized",
        },
      ],
      ...(affectedCode ? { affectedCode } : {}),
      actionLabel: diagnosis.safeToAttemptFix
        ? "Review remediation workflow"
        : "Review issue fallback",
    }

  if (diagnosis?.status === "failed")
    return {
      state: "failed",
      eyebrow: "Fail-closed boundary",
      title: "Diagnosis unavailable",
      summary: diagnosis.error.message,
      supportingEvidence: [],
      checks: [],
      ...(affectedCode ? { affectedCode } : {}),
      actionLabel: "Review workflow state",
    }

  if (incident.investigation)
    return {
      state: "active",
      eyebrow: "Core investigation",
      title: "Investigation in progress",
      summary: `Investigation ${incident.investigation.id} is ${incident.investigation.status.replaceAll("_", " ")}.`,
      supportingEvidence: [],
      checks: [],
      ...(affectedCode ? { affectedCode } : {}),
      actionLabel: "Review workflow state",
    }

  return {
    state: "not-started",
    eyebrow: "Core evidence ready",
    title: "Investigation not started",
    summary:
      "The incident is detected, but Core has not yet produced a validated diagnosis.",
    supportingEvidence: [],
    checks: [],
    ...(affectedCode ? { affectedCode } : {}),
    actionLabel: "Start from workflow",
  }
}

function toGraph(
  incident: DetectedIncident,
  records: IncidentEvidenceRecord[],
  evidence: Evidence[],
  causalPath: IncidentCausalPath | null,
): IncidentGraphViewModel {
  const first = evidence[0]
  const firstMetric = records.find((record) => record.event.kind === "metric")
  const latestMetric = records.findLast(
    (record) => record.event.kind === "metric",
  )
  const firstFailure = records.find(
    (record) =>
      record.event.kind === "trace" || record.event.severity === "error",
  )
  const pathEvidenceId = causalPath?.evidence.id ?? first?.id ?? ""
  const confidence =
    incident.diagnosis?.status === "validated"
      ? Math.round(incident.diagnosis.confidence.value / 100)
      : undefined
  return {
    nodes: [
      {
        id: `deployment:${incident.deploymentId}`,
        slot: "trigger",
        kind: "Deployment",
        title: incident.deploymentId,
        subtitle: incident.affectedService,
        status: "Bound to incident evidence",
        evidenceId: pathEvidenceId,
        why: "Core detected the evidence window on this deployment.",
      },
      {
        id: `signal:${latestMetric?.event.id ?? "unavailable"}`,
        slot: "signal",
        kind: "Metric",
        title: latestMetric
          ? formatEvidenceValue(latestMetric)
          : "Metric unavailable",
        subtitle: latestMetric?.event.timestamp ?? incident.updatedAt,
        status: firstMetric
          ? `Growth observed since ${formatEvidenceValue(firstMetric)}`
          : "No metric record",
        evidenceId: latestMetric?.evidence.id ?? pathEvidenceId,
        why: "The normalized metric crossed the detector's sustained-growth gate.",
      },
      {
        id: `impact:${firstFailure?.event.id ?? "unavailable"}`,
        slot: "impact",
        kind: firstFailure
          ? evidenceSources[firstFailure.event.kind]
          : "Impact",
        title: firstFailure?.event.message ?? "Runtime impact unavailable",
        subtitle: firstFailure?.event.traceId ?? incident.updatedAt,
        status: firstFailure
          ? `${firstFailure.event.severity} telemetry`
          : "No corroborating failure",
        evidenceId: firstFailure?.evidence.id ?? pathEvidenceId,
        why: "This failure corroborates the sustained heap-growth signal.",
      },
      {
        id: `runtime:${causalPath?.container.id ?? incident.affectedService}`,
        slot: "runtime",
        kind: "Runtime",
        title: causalPath?.container.id ?? incident.affectedService,
        subtitle: "Observed container",
        status: causalPath ? "Trusted graph binding" : "Service-level binding",
        evidenceId: pathEvidenceId,
        why: "Core binds telemetry to the runtime identity before following code provenance.",
      },
      {
        id: `cause:${causalPath?.function.id ?? "unresolved"}`,
        slot: "cause",
        kind: "Affected code",
        title:
          causalPath?.function.label ??
          (incident.diagnosis?.status === "validated"
            ? incident.diagnosis.probableRootCause
            : "Code location unresolved"),
        subtitle:
          causalPath?.file.location?.path ??
          causalPath?.file.label ??
          "Awaiting trusted causal path",
        status: causalPath
          ? `Commit ${causalPath.commit.sha}`
          : "No trusted code binding",
        evidenceId: pathEvidenceId,
        why: causalPath
          ? "The trusted code graph connects the deployment commit to this function."
          : "Core has not resolved an evidence-to-code path for this incident.",
      },
    ],
    ...(confidence === undefined ? {} : { confidencePercent: confidence }),
  }
}

function toStatus(workflow: IncidentWorkflowViewModel): IncidentStatus {
  if (workflow.delivery?.status === "delivered") return "Monitoring"
  if (
    workflow.remediation?.status === "running" ||
    workflow.remediation?.status === "completed" ||
    workflow.remediation?.status === "pending_approval"
  )
    return "Mitigating"
  return "Investigating"
}

export function toCoreIncidentWorkspace(input: {
  incident: DetectedIncident
  records: IncidentEvidenceRecord[]
  causalPath: IncidentCausalPath | null
  remediation: IncidentRemediation | null
  delivery: IncidentDelivery | null
  issueDelivery: IncidentIssueDelivery | null
}): IncidentWorkspaceViewModel {
  const evidence = input.records.map(toEvidence)
  const workflow: IncidentWorkflowViewModel = {
    incident: input.incident,
    remediation: input.remediation,
    delivery: input.delivery,
    issueDelivery: input.issueDelivery,
  }
  return {
    id: input.incident.id,
    title:
      input.incident.diagnosis?.status === "validated"
        ? input.incident.diagnosis.summary
        : `Cache growth in ${input.incident.affectedService} after ${input.incident.deploymentId}`,
    severity: "P1",
    service: input.incident.affectedService,
    elapsed: formatDuration(input.incident.createdAt, input.incident.updatedAt),
    status: toStatus(workflow),
    statusEditable: false,
    owner: { name: "Podo Core", avatar: "/icons/robot.svg" },
    evidence,
    remediation: {
      id: input.remediation?.id ?? `uncreated:${input.incident.id}`,
      reviewState:
        input.delivery?.status === "delivered" ? "approved" : "ready",
      branch:
        input.remediation?.artifact?.pullRequestPreview.headBranch ??
        "Not created",
      baseBranch:
        input.remediation?.artifact?.pullRequestPreview.baseBranch ?? "main",
      pullRequest:
        input.delivery?.status === "delivered" && input.delivery.pullRequest
          ? {
              number: input.delivery.pullRequest.number,
              url: input.delivery.pullRequest.url,
            }
          : null,
    },
    diagnosis: toDiagnosis(input.incident, evidence, input.causalPath),
    graph: toGraph(input.incident, input.records, evidence, input.causalPath),
    workflow,
  }
}
