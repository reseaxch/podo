import type {
  DetectedIncident,
  IncidentDiagnosis,
  IncidentInvestigationLink,
  Investigation,
  StartIncidentInvestigationRequest,
} from "@podo/contracts"
import {
  buildInvestigatorPrompt,
  createEvidenceId,
  evaluateReaction,
  formatUntrustedEvidence,
  parseStructuredDiagnosis,
  STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
  validateEvidenceClaims,
  type PromptEvidence,
} from "@podo/domain"
import type { InvestigationService } from "../../investigations"
import type { SettingsStore } from "../../settings"
import type { IncidentAuditStore } from "../audit/incident-audit"
import type { IncidentMonitor } from "../incidents/incident-monitor"
import type { TelemetryEvent } from "../telemetry"

export type StartIncidentInvestigationResult =
  | { ok: true; created: boolean; incident: DetectedIncident; investigation: Investigation }
  | { ok: false; status: 404; error: "not_found"; message: string }
  | { ok: false; status: 409; error: "policy_denied"; message: string }
  | { ok: false; status: 422; error: "invalid_evidence"; message: string }

interface StartedIncidentInvestigation {
  incident: DetectedIncident
  investigation: Investigation
}

export class IncidentInvestigationCoordinator {
  private readonly investigationByIncident = new Map<string, string>()
  private readonly evidenceByIncident = new Map<string, PromptEvidence[]>()
  private readonly diagnosisByIncident = new Map<string, IncidentDiagnosis>()
  private readonly pendingStarts = new Map<string, Promise<StartIncidentInvestigationResult>>()
  private readonly terminalAuditByIncident = new Set<string>()
  private readonly diagnosisAuditByIncident = new Set<string>()

  constructor(
    private readonly incidents: IncidentMonitor,
    private readonly investigations: InvestigationService,
    private readonly settings: SettingsStore,
    private readonly audit: IncidentAuditStore,
  ) {}

  async start(
    incidentId: string,
    input: StartIncidentInvestigationRequest,
  ): Promise<StartIncidentInvestigationResult> {
    const linked = this.getStarted(incidentId)
    if (linked) return { ok: true, created: false, ...linked }

    const pending = this.pendingStarts.get(incidentId)
    if (pending) {
      const result = await pending
      return result.ok ? { ...result, created: false } : result
    }

    const start = this.startNew(incidentId, input)
    this.pendingStarts.set(incidentId, start)
    try {
      return await start
    } finally {
      this.pendingStarts.delete(incidentId)
    }
  }

  publicIncident(incident: DetectedIncident): DetectedIncident {
    const linked = this.getLink(incident.id)
    const diagnosis = this.getDiagnosis(incident)
    return {
      ...incident,
      ...(linked ? { investigation: linked } : {}),
      ...(diagnosis ? { diagnosis } : {}),
    }
  }

  private async startNew(
    incidentId: string,
    input: StartIncidentInvestigationRequest,
  ): Promise<StartIncidentInvestigationResult> {
    const incident = this.incidents.getIncident(incidentId)
    if (!incident) {
      return { ok: false, status: 404, error: "not_found", message: "Incident was not found" }
    }

    this.audit.append(incidentId, { kind: "investigation.requested" })

    const mode = this.settings.get().autonomyMode
    const decision = evaluateReaction({
      mode,
      action: "draft_diagnosis",
      approval: "not_requested",
      regression: "not_run",
      target: "none",
    })
    if (!decision.allowed) {
      return {
        ok: false,
        status: 409,
        error: "policy_denied",
        message: `Autonomy mode ${mode} forbids incident investigation: ${decision.reason}`,
      }
    }

    const events = this.incidents.getEvidenceEvents(incidentId)
    if (!events || events.length !== incident.evidence.length || events.length === 0) {
      return {
        ok: false,
        status: 422,
        error: "invalid_evidence",
        message: "Incident evidence provenance is incomplete",
      }
    }

    const evidence = toPromptEvidence(incident, events)
    const validation = validateEvidenceClaims([{
      claim: `Detector evidence bundle for incident ${incident.id}`,
      evidenceIds: evidence.map((item) => item.id),
    }], evidence)
    if (!validation.valid) {
      return {
        ok: false,
        status: 422,
        error: "invalid_evidence",
        message: validation.errors.join("; "),
      }
    }

    const policy = buildInvestigatorPrompt({ mode })
    const developerInstructions = [
      policy.systemPrompt,
      `Allowed read tools: ${policy.allowedTools.join(", ")}.`,
      `Forbidden tools: ${policy.forbiddenTools.join(", ")}.`,
      "Your final response must be exactly one JSON object with no markdown fences, commentary, or additional fields.",
      `Required schema: ${JSON.stringify({
        schemaVersion: STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
        summary: "string",
        affectedService: "string",
        probableRootCause: "string",
        confidence: { value: 0, scale: "basis_points" },
        evidenceIds: ["supplied-evidence-id"],
        recommendedAction: "string",
        safeToAttemptFix: false,
      })}.`,
      "confidence.value must be an integer from 0 to 10000. affectedService must equal the incident's affected service.",
      "Use only supplied evidence ids. safeToAttemptFix must be boolean and is not an approval or authorization.",
    ].join("\n")
    const prompt = [
      `Incident id: ${incident.id}`,
      `Affected service: ${incident.affectedService}`,
      `Deployment id: ${incident.deploymentId}`,
      `Detector: ${incident.detector}`,
      "Investigate only this incident. Return a structured diagnosis whose material claims cite the supplied evidence ids.",
      formatUntrustedEvidence(evidence),
    ].join("\n")

    this.evidenceByIncident.set(incidentId, evidence)
    const started = await this.investigations.start({
      cwd: input.cwd,
      sandbox: "read-only",
      prompt,
    }, {
      approvalPolicy: "deny_all",
      turnTimeoutMs: this.settings.get().turnTimeoutMs,
      developerInstructions,
      onEvent: (event) => this.auditInvestigationEvent(incidentId, event),
      onApprovalDenied: (investigationId, approvalKind) => {
        this.audit.append(incidentId, {
          kind: "investigation.approval_denied",
          investigationId,
          approvalKind,
        })
      },
    })
    this.investigationByIncident.set(incidentId, started.investigation.id)

    return {
      ok: true,
      created: true,
      incident: this.publicIncident(incident),
      investigation: started.investigation,
    }
  }

  private getStarted(incidentId: string): StartedIncidentInvestigation | null {
    const incident = this.incidents.getIncident(incidentId)
    const investigationId = this.investigationByIncident.get(incidentId)
    const investigation = investigationId ? this.investigations.get(investigationId)?.investigation : undefined
    return incident && investigation
      ? { incident: this.publicIncident(incident), investigation }
      : null
  }

  private getLink(incidentId: string): IncidentInvestigationLink | null {
    const investigationId = this.investigationByIncident.get(incidentId)
    const investigation = investigationId ? this.investigations.get(investigationId)?.investigation : undefined
    return investigation ? {
      id: investigation.id,
      status: investigation.status,
      startedAt: investigation.createdAt,
      updatedAt: investigation.updatedAt,
    } : null
  }

  private getDiagnosis(incident: DetectedIncident): IncidentDiagnosis | null {
    const cached = this.diagnosisByIncident.get(incident.id)
    if (cached) return structuredClone(cached)

    const investigationId = this.investigationByIncident.get(incident.id)
    if (!investigationId) return null
    const investigation = this.investigations.get(investigationId)?.investigation
    if (!investigation) return null

    let diagnosis: IncidentDiagnosis | null = null
    if (investigation.status === "completed") {
      diagnosis = this.parseCompletedDiagnosis(incident, investigationId)
    } else if (investigation.status === "failed") {
      diagnosis = failedDiagnosis(
        "investigation_failed",
        "Investigation failed before producing a validated diagnosis",
      )
    } else if (investigation.status === "cancelled") {
      diagnosis = failedDiagnosis(
        "investigation_cancelled",
        "Investigation was cancelled before producing a validated diagnosis",
      )
    }

    if (!diagnosis) return null
    this.diagnosisByIncident.set(incident.id, diagnosis)
    if (!this.diagnosisAuditByIncident.has(incident.id)) {
      this.diagnosisAuditByIncident.add(incident.id)
      if (diagnosis.status === "validated") {
        this.audit.append(incident.id, {
          kind: "investigation.diagnosis_validated",
          investigationId,
          evidenceIds: [...diagnosis.evidenceIds],
        })
      } else {
        this.audit.append(incident.id, {
          kind: "investigation.diagnosis_rejected",
          investigationId,
          code: diagnosis.error.code,
        })
      }
    }
    return structuredClone(diagnosis)
  }

  private auditInvestigationEvent(incidentId: string, event: import("@podo/contracts").InvestigationEvent): void {
    if (event.kind === "investigation.started") {
      this.investigationByIncident.set(incidentId, event.investigationId)
      this.audit.append(incidentId, { kind: "investigation.started", investigationId: event.investigationId })
      return
    }
    if (this.terminalAuditByIncident.has(incidentId)) return
    if (event.kind === "investigation.completed" || event.kind === "investigation.failed" || event.kind === "investigation.cancelled") {
      this.terminalAuditByIncident.add(incidentId)
      this.audit.append(incidentId, { kind: event.kind, investigationId: event.investigationId })
      const incident = this.incidents.getIncident(incidentId)
      if (incident) this.getDiagnosis(incident)
    }
  }

  private parseCompletedDiagnosis(incident: DetectedIncident, investigationId: string): IncidentDiagnosis {
    const output = this.investigations.getCompletedOutput(investigationId)
    const evidence = this.evidenceByIncident.get(incident.id)
    if (output === null || !evidence) {
      return failedDiagnosis("invalid_output", "Codex output did not satisfy the Podo diagnosis contract")
    }

    const parsed = parseStructuredDiagnosis(output, evidence)
    if (!parsed.ok) {
      return failedDiagnosis("invalid_output", "Codex output did not satisfy the Podo diagnosis contract")
    }
    if (parsed.diagnosis.affectedService !== incident.affectedService) {
      return failedDiagnosis(
        "affected_service_mismatch",
        "Diagnosis affectedService does not match the incident",
      )
    }

    return {
      status: "validated",
      schemaVersion: parsed.diagnosis.schemaVersion,
      summary: parsed.diagnosis.summary,
      affectedService: parsed.diagnosis.affectedService,
      probableRootCause: parsed.diagnosis.probableRootCause,
      confidence: { ...parsed.diagnosis.confidence },
      evidenceIds: [...parsed.diagnosis.evidenceIds],
      recommendedAction: parsed.diagnosis.recommendedAction,
      safeToAttemptFix: parsed.diagnosis.safeToAttemptFix,
    }
  }
}

function failedDiagnosis(
  code: Extract<IncidentDiagnosis, { status: "failed" }>["error"]["code"],
  message: string,
): IncidentDiagnosis {
  return { status: "failed", error: { code, message } }
}

function toPromptEvidence(incident: DetectedIncident, events: readonly TelemetryEvent[]): PromptEvidence[] {
  const eventById = new Map(events.map((event) => [event.id, event]))
  return incident.evidence.map((reference) => {
    const event = eventById.get(reference.sourceEventId)
    if (!event) throw new Error(`Missing telemetry event ${reference.sourceEventId}`)
    return {
      id: createEvidenceId(reference.id),
      sourceType: reference.sourceType,
      content: JSON.stringify({
        sourceEventId: event.id,
        timestamp: event.timestamp,
        service: event.service,
        severity: event.severity,
        message: event.message,
        deploymentId: event.deploymentId,
        commitId: event.commitId,
        traceId: event.traceId,
        containerId: event.containerId,
        metric: event.metric,
      }),
    }
  })
}
