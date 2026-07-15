import type {
  DetectedIncident,
  IncidentInvestigationLink,
  Investigation,
  StartIncidentInvestigationRequest,
} from "@podo/contracts"
import {
  buildInvestigatorPrompt,
  createEvidenceId,
  evaluateReaction,
  formatUntrustedEvidence,
  validateEvidenceClaims,
  type PromptEvidence,
} from "@podo/domain"
import type { InvestigationService } from "../../investigations"
import type { SettingsStore } from "../../settings"
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
  private readonly pendingStarts = new Map<string, Promise<StartIncidentInvestigationResult>>()

  constructor(
    private readonly incidents: IncidentMonitor,
    private readonly investigations: InvestigationService,
    private readonly settings: SettingsStore,
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
    return linked ? { ...incident, investigation: linked } : incident
  }

  private async startNew(
    incidentId: string,
    input: StartIncidentInvestigationRequest,
  ): Promise<StartIncidentInvestigationResult> {
    const incident = this.incidents.getIncident(incidentId)
    if (!incident) {
      return { ok: false, status: 404, error: "not_found", message: "Incident was not found" }
    }

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
    ].join("\n")
    const prompt = [
      `Incident id: ${incident.id}`,
      `Affected service: ${incident.affectedService}`,
      `Deployment id: ${incident.deploymentId}`,
      `Detector: ${incident.detector}`,
      "Investigate only this incident. Return a structured diagnosis whose material claims cite the supplied evidence ids.",
      formatUntrustedEvidence(evidence),
    ].join("\n")

    const started = await this.investigations.start({
      cwd: input.cwd,
      sandbox: "read-only",
      prompt,
    }, { approvalPolicy: "deny_all", developerInstructions })
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
