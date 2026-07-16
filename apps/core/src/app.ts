import { inspectCodexRuntime, isCodexRuntimeCompatible, type CodexRuntime, type CodexRuntimeInfo } from "@podo/codex-app-server-client"
import type {
  AgentChatEvent,
  AgentReadinessResponse,
  ApprovalDecisionRequest,
  GitHubActionsWorkflowRunSignal,
  HealthResponse,
  IncidentRemediationDecisionRequest,
  IngestTelemetryRequest,
  InvestigationEvent,
  SendAgentChatMessageRequest,
  StartInvestigationRequest,
  SystemStatusResponse,
} from "@podo/contracts"
import {
  MAX_GITHUB_ACTIONS_WEBHOOK_BYTES,
  type GitHubActionsRetryRequest,
  type GitHubActionsRunBinding,
  type GitHubActionsWebhookInput,
  type GitHubActionsWorkflowRunListRequest,
} from "@podo/plugin-github"
import { AgentChatService, type AgentChatConfig } from "./agent-chat"
import { InvestigationService } from "./investigations"
import { IncidentMonitor } from "./modules/incidents/incident-monitor"
import { BuildIncidentRegistry } from "./modules/incidents/build-incident-registry"
import {
  BuildIncidentActionService,
  type BuildIncidentActionsPort,
} from "./modules/incidents/build-incident-actions"
import { IncidentCausalPathService, type IncidentGraphConfig } from "./modules/graph/incident-causal-path"
import { IncidentInvestigationCoordinator } from "./modules/investigation/incident-investigation"
import { IncidentAuditStore } from "./modules/audit/incident-audit"
import {
  IncidentRemediationService,
  type IncidentRemediationExecutor,
  type IncidentRemediationSource,
} from "./modules/remediation/incident-remediation"
import { IncidentDeliveryService, type PullRequestDeliveryConfig } from "./modules/remediation/incident-delivery"
import { IncidentIssueService, type IssueDeliveryConfig } from "./modules/remediation/incident-issue"
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
  pullRequestDelivery?: PullRequestDeliveryConfig
  issueDelivery?: IssueDeliveryConfig
  agentChat?: AgentChatConfig
  sseHeartbeatMs?: number
  githubActions?: CoreGitHubActionsConfig
}

export interface CoreGitHubActionsConfig extends BuildIncidentActionsPort {
  repository: { owner: string; name: string }
  repositoryCwd: string
  operatorIdentity: string
  verificationTimeoutMs?: number
  decodeWebhook(input: GitHubActionsWebhookInput): unknown
  captureFailedRun(signal: GitHubActionsWorkflowRunSignal): Promise<unknown>
  getCurrentRun(input: GitHubActionsRunBinding): Promise<unknown>
  listRunsForHead(input: GitHubActionsWorkflowRunListRequest): Promise<unknown>
  retryFailedJobs(input: GitHubActionsRetryRequest): Promise<unknown>
}

const serviceVersion = "0.0.0"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

type WebhookBodyReadResult =
  | { ok: true; body: string }
  | { ok: false }

async function readWebhookBody(request: Request): Promise<WebhookBodyReadResult> {
  const declaredLength = request.headers.get("content-length")
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim()
    const parsedLength = Number(normalizedLength)
    if (!/^\d+$/.test(normalizedLength)
      || !Number.isSafeInteger(parsedLength)
      || parsedLength > MAX_GITHUB_ACTIONS_WEBHOOK_BYTES) {
      await cancelBody(request.body)
      return { ok: false }
    }
  }

  if (!request.body) return { ok: true, body: "" }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (next.value.byteLength > MAX_GITHUB_ACTIONS_WEBHOOK_BYTES - totalBytes) {
        await cancelReader(reader)
        return { ok: false }
      }
      chunks.push(next.value)
      totalBytes += next.value.byteLength
    }
  } catch {
    await cancelReader(reader)
    return { ok: false }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, body: new TextDecoder().decode(bytes) }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return
  try { await body.cancel() } catch {}
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel() } catch {}
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
  const agentChat = options.agentChat
    ? new AgentChatService(() => investigations.acquireRuntime(), options.agentChat, options.eventLogLimit)
    : null
  const settings = new SettingsStore()
  const incidentMonitor = options.incidentMonitor ?? new IncidentMonitor()
  const incidentAudit = new IncidentAuditStore()
  const incidentInvestigations = new IncidentInvestigationCoordinator(incidentMonitor, investigations, settings, incidentAudit)
  const buildIncidents = options.githubActions
    ? new BuildIncidentRegistry({
      repositoryCwd: options.githubActions.repositoryCwd,
      capturePort: { captureFailedRun: (signal) => options.githubActions!.captureFailedRun(signal) },
    }, investigations, settings, incidentAudit)
    : null
  const incidentCausalPaths = new IncidentCausalPathService(incidentMonitor, options.incidentGraph)
  const remediationExecutor = options.remediationExecutor
    ?? options.remediationExecutorFactory?.(() => investigations.acquireRuntime())
  const remediationSource: IncidentRemediationSource = {
    getRemediationContext(incidentId) {
      const incident = incidentMonitor.getIncident(incidentId)
      if (incident) {
        const diagnosis = incidentInvestigations.publicIncident(incident).diagnosis
        return {
          id: incident.id,
          affectedService: incident.affectedService,
          deploymentId: incident.deploymentId,
          evidenceIds: incident.evidence.map(({ id }) => id),
          ...(diagnosis ? { diagnosis } : {}),
        }
      }
      const buildIncident = buildIncidents?.get(incidentId)
      if (!buildIncident) return null
      return {
        id: buildIncident.id,
        affectedService: buildIncident.affectedService,
        deploymentId: `github-actions:${buildIncident.repository}:${buildIncident.sourceRun.id}:${buildIncident.sourceRun.attempt}`,
        evidenceIds: buildIncident.evidence.map(({ id }) => id),
        ...(buildIncident.diagnosis ? { diagnosis: buildIncident.diagnosis } : {}),
        expectedBaseCommit: buildIncident.sourceRun.headSha,
      }
    },
  }
  const incidentRemediations = new IncidentRemediationService(remediationSource, settings, remediationExecutor)
  const incidentDeliveries = new IncidentDeliveryService(incidentRemediations, settings, options.pullRequestDelivery)
  const incidentIssues = new IncidentIssueService(
    incidentMonitor,
    incidentInvestigations,
    incidentRemediations,
    settings,
    incidentAudit,
    options.issueDelivery,
  )
  const buildActions = options.githubActions && buildIncidents
    ? new BuildIncidentActionService({
      repository: options.githubActions.repository,
      operatorIdentity: options.githubActions.operatorIdentity,
      ...(options.githubActions.verificationTimeoutMs === undefined
        ? {}
        : { verificationTimeoutMs: options.githubActions.verificationTimeoutMs }),
      actions: options.githubActions,
    }, buildIncidents, settings, incidentAudit, incidentRemediations, incidentDeliveries)
    : null
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

    if (request.method === "GET" && url.pathname === "/api/agent/readiness") {
      let response: AgentReadinessResponse
      if (!agentChat) {
        response = { service: "podo-core", status: "degraded", version: serviceVersion, chat: { configured: false, available: false, sandbox: "read-only", reason: "not_configured" } }
      } else if (investigations.runtimeError) {
        response = { service: "podo-core", status: "degraded", version: serviceVersion, chat: { configured: true, available: false, sandbox: "read-only", reason: "runtime_failed" } }
      } else {
        let runtimeInfo: CodexRuntimeInfo
        try {
          runtimeInfo = await inspectCodex()
        } catch {
          return json({ service: "podo-core", status: "degraded", version: serviceVersion, chat: { configured: true, available: false, sandbox: "read-only", reason: "codex_unavailable" } } satisfies AgentReadinessResponse)
        }
        if (!isCodexRuntimeCompatible(runtimeInfo)) {
          return json({ service: "podo-core", status: "degraded", version: serviceVersion, chat: { configured: true, available: false, sandbox: "read-only", reason: "version_mismatch" } } satisfies AgentReadinessResponse)
        }
        try {
          await investigations.acquireRuntime()
          response = { service: "podo-core", status: "ready", version: serviceVersion, chat: { configured: true, available: true, sandbox: "read-only" } }
        } catch {
          response = { service: "podo-core", status: "degraded", version: serviceVersion, chat: { configured: true, available: false, sandbox: "read-only", reason: "runtime_failed" } }
        }
      }
      return json(response)
    }

    if (url.pathname === "/api/agent/chats") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const input = await readBody(request)
      if (!isEmptyObject(input)) return json({ error: "invalid_request", message: "No caller-authored chat configuration is accepted" }, 400)
      if (!agentChat) return json({ error: "agent_chat_not_configured" }, 503)
      try {
        if (!isCodexRuntimeCompatible(await inspectCodex())) {
          return json({ error: "codex_version_mismatch", message: "The configured Codex runtime does not match Podo's pinned protocol" }, 503)
        }
        return json({ chat: await agentChat.create() }, 201)
      } catch {
        return json({ error: "agent_unavailable", message: "The Podo agent runtime is unavailable" }, 503)
      }
    }

    const agentChatEventsMatch = url.pathname.match(/^\/api\/agent\/chats\/([^/]+)\/events$/)
    if (agentChatEventsMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      if (!agentChat) return json({ error: "agent_chat_not_configured" }, 503)
      const id = decodeURIComponent(agentChatEventsMatch[1])
      const rawAfter = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0"
      const after = Number(rawAfter)
      if (!Number.isSafeInteger(after) || after < 0) return json({ error: "invalid_event_id" }, 400)
      const replay = agentChat.replay(id, after)
      if (!replay) return json({ error: "not_found" }, 404)
      const earliest = agentChat.earliestSequence(id)
      if (earliest !== null && after < earliest - 1) return json({ error: "event_replay_expired", message: `Earliest available sequence is ${earliest}` }, 409)
      return agentChatEventStream(agentChat, id, replay, options.sseHeartbeatMs ?? 5_000)
    }

    const agentChatMessagesMatch = url.pathname.match(/^\/api\/agent\/chats\/([^/]+)\/messages$/)
    if (agentChatMessagesMatch?.[1]) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      if (!agentChat) return json({ error: "agent_chat_not_configured" }, 503)
      const input = await readBody(request)
      if (!isSendAgentChatMessageRequest(input)) return json({ error: "invalid_request", message: "content and clientRequestId are required; no other fields are accepted" }, 400)
      const result = await agentChat.send(decodeURIComponent(agentChatMessagesMatch[1]), input)
      return result.ok ? json(result.response, result.response.accepted ? 202 : 200) : json({ error: result.error }, result.status)
    }

    const agentChatTurnMatch = url.pathname.match(/^\/api\/agent\/chats\/([^/]+)\/turn$/)
    if (agentChatTurnMatch?.[1]) {
      if (request.method !== "DELETE") return json({ error: "method_not_allowed" }, 405)
      if (!agentChat) return json({ error: "agent_chat_not_configured" }, 503)
      const result = await agentChat.cancel(decodeURIComponent(agentChatTurnMatch[1]))
      return result ? json(result) : json({ error: "not_found" }, 404)
    }

    const agentChatMatch = url.pathname.match(/^\/api\/agent\/chats\/([^/]+)$/)
    if (agentChatMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      if (!agentChat) return json({ error: "agent_chat_not_configured" }, 503)
      const result = agentChat.get(decodeURIComponent(agentChatMatch[1]))
      return result ? json(result) : json({ error: "not_found" }, 404)
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

    if (url.pathname === "/api/github/actions/workflow-runs") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      if (!options.githubActions || !buildIncidents || !buildActions) {
        return json({ error: "github_actions_not_configured" }, 503)
      }
      if ([...url.searchParams.keys()].length > 0
        || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return json({ error: "invalid_webhook", message: "GitHub Actions webhook was invalid" }, 400)
      }
      const body = await readWebhookBody(request)
      if (!body.ok) {
        return json({ error: "invalid_webhook", message: "GitHub Actions webhook was invalid" }, 422)
      }
      const webhookInput: GitHubActionsWebhookInput = {
        eventType: request.headers.get("x-github-event") ?? "",
        deliveryId: request.headers.get("x-github-delivery") ?? "",
        signatureSha256: request.headers.get("x-hub-signature-256") ?? "",
        body: body.body,
      }
      let signal: unknown
      try {
        signal = options.githubActions.decodeWebhook(webhookInput)
      } catch (error) {
        const code = safeErrorCode(error)
        const status = code === "webhook_signature_required" || code === "invalid_webhook_signature" ? 401 : 422
        return json({ error: "invalid_webhook", message: "GitHub Actions webhook was invalid" }, status)
      }
      const result = await buildIncidents.captureFailure(signal)
      return result.ok
        ? json({ created: result.created, incident: buildActions.get(result.incident.id) }, result.created ? 201 : 200)
        : json({ error: result.error, message: result.message }, result.status)
    }

    if (url.pathname === "/api/build-incidents") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      if (!buildActions) return json({ error: "github_actions_not_configured" }, 503)
      return json({ incidents: buildActions.list() })
    }

    const buildIncidentAuditMatch = url.pathname.match(/^\/api\/build-incidents\/([^/]+)\/audit$/)
    if (buildIncidentAuditMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      const incidentId = decodeURIComponent(buildIncidentAuditMatch[1])
      if (!buildIncidents?.get(incidentId)) return json({ error: "not_found" }, 404)
      return json({ events: incidentAudit.getBuild(incidentId) })
    }

    const buildIncidentRetryApprovalMatch = url.pathname.match(
      /^\/api\/build-incidents\/([^/]+)\/retry\/approvals\/([^/]+)$/,
    )
    if (buildIncidentRetryApprovalMatch?.[1] && buildIncidentRetryApprovalMatch[2]) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      if (!buildActions) return json({ error: "github_actions_not_configured" }, 503)
      const input = await readBody(request)
      if (!isBuildRetryDecision(input)) return json({ error: "invalid_request" }, 400)
      const result = await buildActions.decideRetry(
        decodeURIComponent(buildIncidentRetryApprovalMatch[1]),
        decodeURIComponent(buildIncidentRetryApprovalMatch[2]),
        input.decision,
      )
      return result.ok
        ? json({ incident: result.incident, retry: result.retry })
        : json({ error: result.error, message: result.message }, result.status)
    }

    const buildIncidentRetryMatch = url.pathname.match(/^\/api\/build-incidents\/([^/]+)\/retry$/)
    if (buildIncidentRetryMatch?.[1]) {
      if (!buildActions) return json({ error: "github_actions_not_configured" }, 503)
      const incidentId = decodeURIComponent(buildIncidentRetryMatch[1])
      if (request.method === "GET") {
        const result = await buildActions.getRetry(incidentId)
        return result.ok
          ? json({ incident: result.incident, retry: result.retry })
          : json({ error: result.error, message: result.message }, result.status)
      }
      if (request.method === "POST") {
        const input = await readBody(request)
        if (!isEmptyObject(input)) {
          return json({ error: "invalid_request", message: "No caller-authored retry input is accepted" }, 400)
        }
        const result = buildActions.startRetry(incidentId)
        return result.ok
          ? json({ incident: result.incident, retry: result.retry }, result.created ? 201 : 200)
          : json({ error: result.error, message: result.message }, result.status)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    const buildRemediationVerificationMatch = url.pathname.match(
      /^\/api\/build-incidents\/([^/]+)\/remediation\/verification$/,
    )
    if (buildRemediationVerificationMatch?.[1]) {
      if (!buildActions) return json({ error: "github_actions_not_configured" }, 503)
      const incidentId = decodeURIComponent(buildRemediationVerificationMatch[1])
      if (request.method === "GET") {
        const result = await buildActions.getRemediationVerification(incidentId)
        return result.ok
          ? json({ incident: result.incident, verification: result.verification })
          : json({ error: result.error, message: result.message }, result.status)
      }
      if (request.method === "POST") {
        const input = await readBody(request)
        if (!isEmptyObject(input)) {
          return json({ error: "invalid_request", message: "No caller-authored verification input is accepted" }, 400)
        }
        const result = await buildActions.startRemediationVerification(incidentId)
        return result.ok
          ? json({ incident: result.incident, verification: result.verification }, result.created ? 201 : 200)
          : json({ error: result.error, message: result.message }, result.status)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    const buildIncidentMatch = url.pathname.match(/^\/api\/build-incidents\/([^/]+)$/)
    if (buildIncidentMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      if (!buildActions) return json({ error: "github_actions_not_configured" }, 503)
      const incident = buildActions.get(decodeURIComponent(buildIncidentMatch[1]))
      return incident ? json({ incident }) : json({ error: "not_found" }, 404)
    }

    const incidentAuditMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/audit$/)
    if (incidentAuditMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      const incidentId = decodeURIComponent(incidentAuditMatch[1])
      if (!incidentMonitor.getIncident(incidentId)) return json({ error: "not_found" }, 404)
      return json({ events: incidentAudit.get(incidentId) })
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

    const incidentIssueMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/issue$/)
    if (incidentIssueMatch?.[1]) {
      const incidentId = decodeURIComponent(incidentIssueMatch[1])
      if (request.method === "GET") {
        const result = incidentIssues.get(incidentId)
        return result.ok
          ? json({ issueDelivery: result.issueDelivery })
          : json({ error: result.error, message: result.message }, result.status)
      }
      if (request.method === "POST") {
        const input = await readBody(request)
        if (!isEmptyObject(input)) return json({ error: "invalid_request", message: "No caller-authored issue input is accepted" }, 400)
        const result = await incidentIssues.start(incidentId)
        return result.ok
          ? json({ issueDelivery: result.issueDelivery }, result.created ? 201 : 200)
          : json({ error: result.error, message: result.message }, result.status)
      }
      return json({ error: "method_not_allowed" }, 405)
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

    const incidentRemediationAuditMatch = url.pathname.match(/^\/api\/(?:incidents|build-incidents)\/([^/]+)\/remediation\/audit$/)
    if (incidentRemediationAuditMatch?.[1]) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
      const result = incidentRemediations.audit(decodeURIComponent(incidentRemediationAuditMatch[1]))
      return result.ok ? json({ events: result.events }) : json({ error: "not_found" }, 404)
    }

    const incidentDeliveryMatch = url.pathname.match(/^\/api\/(?:incidents|build-incidents)\/([^/]+)\/remediation\/delivery$/)
    if (incidentDeliveryMatch?.[1]) {
      const incidentId = decodeURIComponent(incidentDeliveryMatch[1])
      if (request.method === "GET") {
        const result = incidentDeliveries.get(incidentId)
        return result.ok
          ? json({ delivery: result.delivery })
          : json({ error: result.error, message: result.message }, result.status)
      }
      if (request.method === "POST") {
        const input = await readBody(request)
        if (!isEmptyObject(input)) return json({ error: "invalid_request", message: "No caller-authored delivery input is accepted" }, 400)
        const result = incidentDeliveries.start(incidentId)
        if (result.ok) buildActions?.syncRemediation(incidentId)
        return result.ok
          ? json({ delivery: result.delivery }, result.created ? 201 : 200)
          : json({ error: result.error, message: result.message }, result.status)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    const incidentDeliveryApprovalMatch = url.pathname.match(/^\/api\/(?:incidents|build-incidents)\/([^/]+)\/remediation\/delivery\/approvals\/([^/]+)$/)
    if (incidentDeliveryApprovalMatch?.[1] && incidentDeliveryApprovalMatch[2]) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const input = await readBody(request)
      if (!isIncidentRemediationDecision(input)) return json({ error: "invalid_request" }, 400)
      const result = await incidentDeliveries.decide(
        decodeURIComponent(incidentDeliveryApprovalMatch[1]),
        decodeURIComponent(incidentDeliveryApprovalMatch[2]),
        input.decision,
      )
      if (result.ok) buildActions?.syncRemediation(decodeURIComponent(incidentDeliveryApprovalMatch[1]))
      return result.ok
        ? json({ delivery: result.delivery })
        : json({ error: result.error, message: result.message }, result.status)
    }

    const incidentRemediationMatch = url.pathname.match(/^\/api\/(?:incidents|build-incidents)\/([^/]+)\/remediation$/)
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
        const buildIncident = buildIncidents?.get(incidentId)
        const existingRemediation = incidentRemediations.get(incidentId)
        if (buildIncident
          && !existingRemediation.ok
          && buildIncident.status !== "awaiting_action"
          && buildIncident.status !== "denied"
          && buildIncident.status !== "failed") {
          return json({ error: "resolution_in_progress", message: "Build incident already has an active resolution branch" }, 409)
        }
        const result = incidentRemediations.start(incidentId)
        if (result.ok) buildActions?.syncRemediation(incidentId)
        return result.ok
          ? json({ remediation: result.remediation }, result.created ? 201 : 200)
          : json({ error: result.error, message: result.message }, result.status)
      }
      return json({ error: "method_not_allowed" }, 405)
    }

    const incidentRemediationApprovalMatch = url.pathname.match(/^\/api\/(?:incidents|build-incidents)\/([^/]+)\/remediation\/approvals\/([^/]+)$/)
    if (incidentRemediationApprovalMatch?.[1] && incidentRemediationApprovalMatch[2]) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const input = await readBody(request)
      if (!isIncidentRemediationDecision(input)) return json({ error: "invalid_request" }, 400)
      const result = await incidentRemediations.decide(
        decodeURIComponent(incidentRemediationApprovalMatch[1]),
        decodeURIComponent(incidentRemediationApprovalMatch[2]),
        input.decision,
      )
      if (result.ok) buildActions?.syncRemediation(decodeURIComponent(incidentRemediationApprovalMatch[1]))
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
      return json(await investigations.start(input, { turnTimeoutMs: settings.get().turnTimeoutMs }), 201)
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
      return eventStream(investigations, id, replay, options.sseHeartbeatMs ?? 5_000)
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

function eventStream(service: InvestigationService, id: string, replay: InvestigationEvent[], heartbeatMs: number): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    unsubscribe?.()
    unsubscribe = null
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of replay) controller.enqueue(encoder.encode(toSse(event)))
      if (service.isTerminal(id)) {
        controller.close()
        return
      }
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), heartbeatMs)
      unsubscribe = service.subscribe(id, (event) => {
        controller.enqueue(encoder.encode(toSse(event)))
        if (event.kind === "investigation.completed" || event.kind === "investigation.cancelled" || event.kind === "investigation.failed") {
          stop()
          controller.close()
        }
      })
    },
    cancel() { stop() },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } })
}

function agentChatEventStream(service: AgentChatService, id: string, replay: AgentChatEvent[], heartbeatMs: number): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    unsubscribe?.()
    unsubscribe = null
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of replay) controller.enqueue(encoder.encode(toSse(event)))
      const last = replay.at(-1)
      if (last && (last.kind === "message.completed" || last.kind === "turn.cancelled" || last.kind === "chat.failed")) {
        controller.close()
        return
      }
      if (service.get(id)?.chat.status !== "running") {
        controller.close()
        return
      }
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), heartbeatMs)
      unsubscribe = service.subscribe(id, (event) => {
        controller.enqueue(encoder.encode(toSse(event)))
        if (event.kind === "message.completed" || event.kind === "turn.cancelled" || event.kind === "chat.failed") {
          stop()
          controller.close()
        }
      })
    },
    cancel() { stop() },
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

function isSendAgentChatMessageRequest(value: unknown): value is SendAgentChatMessageRequest {
  if (!isPlainObject(value) || Object.keys(value).length !== 2) return false
  return typeof value.content === "string"
    && value.content.trim().length > 0
    && value.content.length <= 8_000
    && value.content === value.content.trim()
    && typeof value.clientRequestId === "string"
    && value.clientRequestId.length > 0
    && value.clientRequestId.length <= 128
    && value.clientRequestId === value.clientRequestId.trim()
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

function isBuildRetryDecision(value: unknown): value is { decision: "approve" | "deny" } {
  return isPlainObject(value)
    && Object.keys(value).length === 1
    && (value.decision === "approve" || value.decision === "deny")
}

function safeErrorCode(value: unknown): string | null {
  return isPlainObject(value) && typeof value.code === "string" && value.code.length <= 128
    ? value.code
    : null
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
