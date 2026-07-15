import { inspectCodexRuntime, type CodexRuntime, type CodexRuntimeInfo } from "@podo/codex-app-server-client"
import type {
  ApprovalDecisionRequest,
  HealthResponse,
  IncidentRemediationDecisionRequest,
  IngestTelemetryRequest,
  InvestigationEvent,
  StartInvestigationRequest,
  SystemStatusResponse,
} from "@podo/contracts"
import { InvestigationService } from "./investigations"
import { IncidentMonitor } from "./modules/incidents/incident-monitor"
import { IncidentCausalPathService, type IncidentGraphConfig } from "./modules/graph/incident-causal-path"
import { IncidentInvestigationCoordinator } from "./modules/investigation/incident-investigation"
import { IncidentRemediationService, type IncidentRemediationExecutor } from "./modules/remediation/incident-remediation"
import { SettingsStore } from "./settings"

export interface CoreHandlerOptions {
  inspectCodex?: () => Promise<CodexRuntimeInfo>
  runtime?: CodexRuntime
  createRuntime?: () => Promise<CodexRuntime>
  eventLogLimit?: number
  incidentMonitor?: IncidentMonitor
  incidentGraph?: IncidentGraphConfig
  remediationExecutor?: IncidentRemediationExecutor
  remediationExecutorFactory?: (runtimeProvider: () => Promise<CodexRuntime>) => IncidentRemediationExecutor
}

const serviceVersion = "0.0.0"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

export function createCoreHandler(options: CoreHandlerOptions = {}): (request: Request) => Promise<Response> {
  if (options.remediationExecutor && options.remediationExecutorFactory) {
    throw new Error("remediation_executor_configuration_is_ambiguous")
  }
  const inspectCodex = options.inspectCodex ?? (() => inspectCodexRuntime())
  const investigations = new InvestigationService({
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.createRuntime ? { createRuntime: options.createRuntime } : {}),
    ...(options.eventLogLimit === undefined ? {} : { eventLogLimit: options.eventLogLimit }),
  })
  const settings = new SettingsStore()
  const incidentMonitor = options.incidentMonitor ?? new IncidentMonitor()
  const incidentInvestigations = new IncidentInvestigationCoordinator(incidentMonitor, investigations, settings)
  const incidentCausalPaths = new IncidentCausalPathService(incidentMonitor, options.incidentGraph)
  const remediationExecutor = options.remediationExecutor
    ?? options.remediationExecutorFactory?.(() => investigations.acquireRuntime())
  const incidentRemediations = new IncidentRemediationService(incidentMonitor, incidentInvestigations, settings, remediationExecutor)
  const remediationStatus = { configured: remediationExecutor !== undefined }

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/healthz") {
      const response: HealthResponse = { service: "podo-core", status: "ok", version: serviceVersion }
      return json(response)
    }

    if (request.method === "GET" && (url.pathname === "/readyz" || url.pathname === "/api/system")) {
      let response: SystemStatusResponse
      try {
        const runtime = await inspectCodex()
        const runtimeError = investigations.runtimeError
        response = runtimeError
          ? { service: "podo-core", status: "degraded", version: serviceVersion, codex: { available: false, binary: runtime.binary, transport: "stdio", version: runtime.version, error: runtimeError }, remediation: remediationStatus }
          : { service: "podo-core", status: "ready", version: serviceVersion, codex: { available: true, binary: runtime.binary, transport: "stdio", version: runtime.version }, remediation: remediationStatus }
      } catch (error) {
        response = { service: "podo-core", status: "degraded", version: serviceVersion, codex: { available: false, binary: process.env.CODEX_BIN ?? "codex", transport: "stdio", version: null, error: error instanceof Error ? error.message : String(error) }, remediation: remediationStatus }
      }
      return json(response, url.pathname === "/readyz" && response.status !== "ready" ? 503 : 200)
    }

    if (url.pathname === "/api/settings") {
      if (request.method === "GET") return json({ settings: settings.get() })
      if (request.method === "PATCH") {
        const updated = settings.update(await readBody(request))
        return updated
          ? json({ settings: updated })
          : json({ error: "invalid_settings", message: "Settings patch contains unknown or invalid values" }, 400)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    if (url.pathname === "/api/telemetry/events") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const input = await readBody(request)
      if (!isTelemetryBatch(input)) {
        return json({ error: "invalid_telemetry_batch", message: "events must be a non-empty array of objects" }, 400)
      }
      const result = incidentMonitor.ingest(input.events)
      return json({
        ...result,
        incident: result.incident ? incidentInvestigations.publicIncident(result.incident) : null,
      })
    }

    if (url.pathname === "/api/incidents") {
      return request.method === "GET"
        ? json({ incidents: incidentMonitor.listIncidents().map((incident) => incidentInvestigations.publicIncident(incident)) })
        : json({ error: "method_not_allowed" }, 405)
    }

    const incidentInvestigationMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/investigation$/)
    if (incidentInvestigationMatch?.[1]) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const input = await readBody(request)
      if (!isStartIncidentInvestigationRequest(input)) {
        return json({ error: "invalid_request", message: "An absolute cwd is required and no other fields are accepted" }, 400)
      }
      const result = await incidentInvestigations.start(decodeURIComponent(incidentInvestigationMatch[1]), input)
      return result.ok
        ? json({ incident: result.incident, investigation: result.investigation }, result.created ? 201 : 200)
        : json({ error: result.error, message: result.message }, result.status)
    }

    const incidentCausalPathMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/causal-path$/)
    if (incidentCausalPathMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      const evidenceIds = url.searchParams.getAll("evidenceId")
      const queryKeys = [...url.searchParams.keys()]
      if (evidenceIds.length !== 1
        || evidenceIds[0]?.trim().length === 0
        || queryKeys.some((key) => key !== "evidenceId")) {
        return json({ error: "invalid_request", message: "Exactly one non-empty evidenceId query parameter is required" }, 400)
      }
      const result = incidentCausalPaths.resolve(decodeURIComponent(incidentCausalPathMatch[1]), evidenceIds[0]!)
      return result.ok
        ? json(result.response)
        : json({ error: result.error, message: result.message }, result.status)
    }

    const incidentRemediationMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/remediation$/)
    if (incidentRemediationMatch?.[1]) {
      const incidentId = decodeURIComponent(incidentRemediationMatch[1])
      if (request.method === "GET") {
        const result = incidentRemediations.get(incidentId)
        return result.ok
          ? json({ remediation: result.remediation })
          : json({ error: result.error, message: result.message }, result.status)
      }
      if (request.method === "POST") {
        const input = await readBody(request)
        if (!isEmptyObject(input)) return json({ error: "invalid_request", message: "No caller-authored remediation input is accepted" }, 400)
        const result = incidentRemediations.start(incidentId)
        return result.ok
          ? json({ remediation: result.remediation }, result.created ? 201 : 200)
          : json({ error: result.error, message: result.message }, result.status)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    const incidentRemediationApprovalMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/remediation\/approvals\/([^/]+)$/)
    if (incidentRemediationApprovalMatch?.[1] && incidentRemediationApprovalMatch[2]) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const input = await readBody(request)
      if (!isIncidentRemediationDecision(input)) return json({ error: "invalid_request" }, 400)
      const result = await incidentRemediations.decide(
        decodeURIComponent(incidentRemediationApprovalMatch[1]),
        decodeURIComponent(incidentRemediationApprovalMatch[2]),
        input.decision,
      )
      return result.ok
        ? json({ remediation: result.remediation })
        : json({ error: result.error, message: result.message }, result.status)
    }

    const incidentMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)$/)
    if (incidentMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      const incident = incidentMonitor.getIncident(decodeURIComponent(incidentMatch[1]))
      return incident
        ? json({ incident: incidentInvestigations.publicIncident(incident) })
        : json({ error: "not_found" }, 404)
    }

    if (url.pathname === "/api/investigations" && request.method === "POST") {
      const input = await readBody(request)
      if (!isStartRequest(input)) return json({ error: "invalid_request", message: "prompt, absolute cwd, and sandbox policy are required" }, 400)
      return json(await investigations.start(input), 201)
    }

    const eventsMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/events$/)
    if (eventsMatch?.[1] && request.method === "GET") {
      const id = decodeURIComponent(eventsMatch[1])
      const rawAfter = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0"
      const after = Number(rawAfter)
      if (!Number.isSafeInteger(after) || after < 0) return json({ error: "invalid_event_id" }, 400)
      const replay = investigations.replay(id, after)
      if (!replay) return json({ error: "not_found" }, 404)
      const earliest = investigations.earliestSequence(id)
      if (earliest !== null && after < earliest - 1) return json({ error: "event_replay_expired", message: `Earliest available sequence is ${earliest}` }, 409)
      return eventStream(investigations, id, replay)
    }

    const approvalMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/approvals\/([^/]+)$/)
    if (approvalMatch?.[1] && approvalMatch[2] && request.method === "POST") {
      const input = await readBody(request)
      if (!isApprovalDecision(input)) return json({ error: "invalid_request" }, 400)
      const result = await investigations.decideApproval(decodeURIComponent(approvalMatch[1]), decodeURIComponent(approvalMatch[2]), input)
      return result ? json(result) : json({ error: "approval_not_found" }, 404)
    }

    const investigationMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)$/)
    if (investigationMatch?.[1]) {
      const id = decodeURIComponent(investigationMatch[1])
      if (request.method === "GET") {
        const result = investigations.get(id)
        return result ? json(result) : json({ error: "not_found" }, 404)
      }
      if (request.method === "DELETE") {
        const result = await investigations.cancel(id)
        return result ? json(result) : json({ error: "not_found" }, 404)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return json({ error: "method_not_allowed" }, 405)
    return json({ error: "not_found" }, 404)
  }
}

function eventStream(service: InvestigationService, id: string, replay: InvestigationEvent[]): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of replay) controller.enqueue(encoder.encode(toSse(event)))
      if (service.isTerminal(id)) {
        controller.close()
        return
      }
      unsubscribe = service.subscribe(id, (event) => {
        controller.enqueue(encoder.encode(toSse(event)))
        if (event.kind === "investigation.completed" || event.kind === "investigation.cancelled" || event.kind === "investigation.failed") {
          unsubscribe?.()
          controller.close()
        }
      })
    },
    cancel() { unsubscribe?.() },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } })
}

function toSse(event: { sequence: number; kind: string }): string {
  return `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

async function readBody(request: Request): Promise<unknown> {
  try { return await request.json() } catch { return null }
}

function isStartRequest(value: unknown): value is StartInvestigationRequest {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  return Object.keys(input).length === 3
    && typeof input.prompt === "string" && input.prompt.trim().length > 0
    && typeof input.cwd === "string" && input.cwd.startsWith("/")
    && (input.sandbox === "read-only" || input.sandbox === "workspace-write")
}

function isStartIncidentInvestigationRequest(value: unknown): value is { cwd: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return Object.keys(input).length === 1
    && typeof input.cwd === "string"
    && input.cwd.startsWith("/")
}

function isApprovalDecision(value: unknown): value is ApprovalDecisionRequest {
  if (!value || typeof value !== "object") return false
  const input = value as Record<string, unknown>
  if (input.decision !== "approve" && input.decision !== "deny") return false
  if (input.answers === undefined) return true
  if (!input.answers || typeof input.answers !== "object" || Array.isArray(input.answers)) return false
  return Object.values(input.answers).every((answer) => Array.isArray(answer) && answer.every((entry) => typeof entry === "string"))
}

function isIncidentRemediationDecision(value: unknown): value is IncidentRemediationDecisionRequest {
  return isPlainObject(value)
    && Object.keys(value).length === 1
    && (value.decision === "approve" || value.decision === "deny")
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isPlainObject(value) && Object.keys(value).length === 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isTelemetryBatch(value: unknown): value is IngestTelemetryRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return Object.keys(input).length === 1
    && Array.isArray(input.events)
    && input.events.length > 0
    && input.events.every((event) => Boolean(event) && typeof event === "object" && !Array.isArray(event))
}
