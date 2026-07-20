import type {
  AgentChatEvent,
  AgentReadinessResponse,
  ApprovalDecisionResponse,
  BuildIncidentRetryDecisionRequest,
  BuildIncidentRetryDecisionResponse,
  CancelAgentChatTurnResponse,
  CancelInvestigationResponse,
  CreateAgentChatResponse,
  GetAgentChatResponse,
  GetBuildIncidentAuditResponse,
  GetBuildIncidentResponse,
  GetBuildIncidentRetryResponse,
  GetBuildRemediationVerificationResponse,
  GetInvestigationResponse,
  GetIncidentCausalPathResponse,
  GetIncidentEvidenceResponse,
  GetIncidentResponse,
  GetIncidentAuditResponse,
  GetIncidentIssueResponse,
  GetIncidentDeliveryResponse,
  GetIncidentRemediationAuditResponse,
  GetIncidentTelemetryComparisonResponse,
  GetSettingsResponse,
  HealthResponse,
  IngestTelemetryResponse,
  GetIncidentRemediationResponse,
  IncidentRemediationDecisionResponse,
  IncidentDeliveryDecisionResponse,
  InvestigationEvent,
  ListBuildIncidentsResponse,
  ListIncidentsResponse,
  SendAgentChatMessageRequest,
  SendAgentChatMessageResponse,
  StartIncidentInvestigationRequest,
  StartIncidentInvestigationResponse,
  StartIncidentIssueResponse,
  StartIncidentRemediationResponse,
  StartIncidentDeliveryResponse,
  StartBuildIncidentRetryResponse,
  StartBuildRemediationVerificationResponse,
  StartInvestigationRequest,
  StartInvestigationResponse,
  SystemStatusResponse,
  TelemetryEventInput,
  UpdateSettingsRequest,
  UpdateSettingsResponse,
} from "@podo/contracts"

export interface PodoClientOptions {
  baseUrl?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export interface SubscribeEventsOptions {
  afterSequence?: number
  signal?: AbortSignal
}

export interface PodoClient {
  health(): Promise<HealthResponse>
  systemStatus(): Promise<SystemStatusResponse>
  getSettings(): Promise<GetSettingsResponse>
  updateSettings(input: UpdateSettingsRequest): Promise<UpdateSettingsResponse>
  ingestTelemetry(events: TelemetryEventInput[]): Promise<IngestTelemetryResponse>
  listIncidents(): Promise<ListIncidentsResponse>
  getIncident(id: string): Promise<GetIncidentResponse>
  start(input: StartInvestigationRequest): Promise<StartInvestigationResponse>
  get(id: string): Promise<GetInvestigationResponse>
  cancel(id: string): Promise<CancelInvestigationResponse>
  startInvestigation(input: StartInvestigationRequest): Promise<StartInvestigationResponse>
  getInvestigation(id: string): Promise<GetInvestigationResponse>
  cancelInvestigation(id: string): Promise<CancelInvestigationResponse>
  approve(id: string, approvalId: string, answers?: Record<string, string[]>): Promise<ApprovalDecisionResponse>
  deny(id: string, approvalId: string): Promise<ApprovalDecisionResponse>
  subscribeEvents(id: string, options?: SubscribeEventsOptions): AsyncIterable<InvestigationEvent>
}

export interface PodoAgentChatClient {
  agentReadiness(): Promise<AgentReadinessResponse>
  createAgentChat(): Promise<CreateAgentChatResponse>
  getAgentChat(id: string): Promise<GetAgentChatResponse>
  sendAgentChatMessage(id: string, input: SendAgentChatMessageRequest): Promise<SendAgentChatMessageResponse>
  cancelAgentChatTurn(id: string): Promise<CancelAgentChatTurnResponse>
  subscribeAgentChatEvents(id: string, options?: SubscribeEventsOptions): AsyncIterable<AgentChatEvent>
}

export interface PodoIncidentClient extends PodoClient {
  startIncidentInvestigation(id: string, input: StartIncidentInvestigationRequest): Promise<StartIncidentInvestigationResponse>
  getIncidentCausalPath(id: string, evidenceId: string): Promise<GetIncidentCausalPathResponse>
  getIncidentEvidence(id: string): Promise<GetIncidentEvidenceResponse>
  getIncidentTelemetryComparison(id: string): Promise<GetIncidentTelemetryComparisonResponse>
}

export interface PodoIncidentAuditClient {
  getIncidentAudit(id: string): Promise<GetIncidentAuditResponse>
}

export interface PodoBuildIncidentClient {
  listBuildIncidents(): Promise<ListBuildIncidentsResponse>
  getBuildIncident(id: string): Promise<GetBuildIncidentResponse>
  getBuildIncidentAudit(id: string): Promise<GetBuildIncidentAuditResponse>
  startBuildIncidentRetry(id: string): Promise<StartBuildIncidentRetryResponse>
  getBuildIncidentRetry(id: string): Promise<GetBuildIncidentRetryResponse>
  decideBuildIncidentRetry(
    id: string,
    approvalId: string,
    input: BuildIncidentRetryDecisionRequest,
  ): Promise<BuildIncidentRetryDecisionResponse>
  startBuildRemediationVerification(id: string): Promise<StartBuildRemediationVerificationResponse>
  getBuildRemediationVerification(id: string): Promise<GetBuildRemediationVerificationResponse>
}

export interface PodoIncidentIssueClient {
  startIncidentIssue(id: string): Promise<StartIncidentIssueResponse>
  getIncidentIssue(id: string): Promise<GetIncidentIssueResponse>
}

export interface PodoRemediationClient {
  startIncidentRemediation(id: string): Promise<StartIncidentRemediationResponse>
  getIncidentRemediation(id: string): Promise<GetIncidentRemediationResponse>
  getIncidentRemediationAudit(id: string): Promise<GetIncidentRemediationAuditResponse>
  approveIncidentRemediation(id: string, approvalId: string): Promise<IncidentRemediationDecisionResponse>
  denyIncidentRemediation(id: string, approvalId: string): Promise<IncidentRemediationDecisionResponse>
  startIncidentDelivery(id: string): Promise<StartIncidentDeliveryResponse>
  getIncidentDelivery(id: string): Promise<GetIncidentDeliveryResponse>
  approveIncidentDelivery(id: string, approvalId: string): Promise<IncidentDeliveryDecisionResponse>
  denyIncidentDelivery(id: string, approvalId: string): Promise<IncidentDeliveryDecisionResponse>
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Podo request failed (${response.status}): ${detail}`)
  }
  return (await response.json()) as T
}

export function createPodoClient(options: PodoClientOptions = {}): PodoClient
  & PodoAgentChatClient
  & PodoIncidentClient
  & PodoIncidentAuditClient
  & PodoIncidentIssueClient
  & PodoRemediationClient
  & PodoBuildIncidentClient {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:4100").replace(/\/$/, "")
  const request = options.fetch ?? globalThis.fetch
  const investigationUrl = (id: string) => `${baseUrl}/api/investigations/${encodeURIComponent(id)}`
  const agentChatUrl = (id: string) => `${baseUrl}/api/agent/chats/${encodeURIComponent(id)}`
  const buildIncidentUrl = (id: string) => `${baseUrl}/api/build-incidents/${encodeURIComponent(id)}`
  const command = async <T>(url: string, method: string, body?: unknown) => readJson<T>(await request(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }))

  return {
    health: async () => readJson<HealthResponse>(await request(`${baseUrl}/healthz`)),
    systemStatus: async () => readJson<SystemStatusResponse>(await request(`${baseUrl}/api/system`)),
    agentReadiness: async () => readJson<AgentReadinessResponse>(await request(`${baseUrl}/api/agent/readiness`)),
    createAgentChat: () => command<CreateAgentChatResponse>(`${baseUrl}/api/agent/chats`, "POST", {}),
    getAgentChat: async (id) => readJson<GetAgentChatResponse>(await request(agentChatUrl(id))),
    sendAgentChatMessage: (id, input) => command<SendAgentChatMessageResponse>(`${agentChatUrl(id)}/messages`, "POST", input),
    cancelAgentChatTurn: (id) => command<CancelAgentChatTurnResponse>(`${agentChatUrl(id)}/turn`, "DELETE"),
    subscribeAgentChatEvents(id, subscribeOptions = {}) {
      return streamSse<AgentChatEvent>(request, `${agentChatUrl(id)}/events`, subscribeOptions, "Podo agent chat stream")
    },
    getSettings: async () => readJson<GetSettingsResponse>(await request(`${baseUrl}/api/settings`)),
    updateSettings: (input) => command<UpdateSettingsResponse>(`${baseUrl}/api/settings`, "PATCH", input),
    ingestTelemetry: (events) => command<IngestTelemetryResponse>(`${baseUrl}/api/telemetry/events`, "POST", { events }),
    listIncidents: async () => readJson<ListIncidentsResponse>(await request(`${baseUrl}/api/incidents`)),
    getIncident: async (id) => readJson<GetIncidentResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}`)),
    getIncidentAudit: async (id) => readJson<GetIncidentAuditResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/audit`)),
    listBuildIncidents: async () => readJson<ListBuildIncidentsResponse>(await request(`${baseUrl}/api/build-incidents`)),
    getBuildIncident: async (id) => readJson<GetBuildIncidentResponse>(await request(buildIncidentUrl(id))),
    getBuildIncidentAudit: async (id) => readJson<GetBuildIncidentAuditResponse>(await request(`${buildIncidentUrl(id)}/audit`)),
    startBuildIncidentRetry: (id) => command<StartBuildIncidentRetryResponse>(`${buildIncidentUrl(id)}/retry`, "POST", {}),
    getBuildIncidentRetry: async (id) => readJson<GetBuildIncidentRetryResponse>(await request(`${buildIncidentUrl(id)}/retry`)),
    decideBuildIncidentRetry: (id, approvalId, input) => command<BuildIncidentRetryDecisionResponse>(
      `${buildIncidentUrl(id)}/retry/approvals/${encodeURIComponent(approvalId)}`,
      "POST",
      input,
    ),
    startBuildRemediationVerification: (id) => command<StartBuildRemediationVerificationResponse>(
      `${buildIncidentUrl(id)}/remediation/verification`,
      "POST",
      {},
    ),
    getBuildRemediationVerification: async (id) => readJson<GetBuildRemediationVerificationResponse>(
      await request(`${buildIncidentUrl(id)}/remediation/verification`),
    ),
    startIncidentIssue: (id) => command<StartIncidentIssueResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/issue`, "POST", {}),
    getIncidentIssue: async (id) => readJson<GetIncidentIssueResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/issue`)),
    getIncidentCausalPath: async (id, evidenceId) => readJson<GetIncidentCausalPathResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/causal-path?evidenceId=${encodeURIComponent(evidenceId)}`)),
    getIncidentEvidence: async (id) => readJson<GetIncidentEvidenceResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/evidence`)),
    getIncidentTelemetryComparison: async (id) => readJson<GetIncidentTelemetryComparisonResponse>(
      await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/telemetry-comparison`),
    ),
    startIncidentInvestigation: (id, input) => command<StartIncidentInvestigationResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/investigation`, "POST", input),
    startIncidentRemediation: (id) => command<StartIncidentRemediationResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation`, "POST", {}),
    getIncidentRemediation: async (id) => readJson<GetIncidentRemediationResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation`)),
    getIncidentRemediationAudit: async (id) => readJson<GetIncidentRemediationAuditResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/audit`)),
    approveIncidentRemediation: (id, approvalId) => command<IncidentRemediationDecisionResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "approve" }),
    denyIncidentRemediation: (id, approvalId) => command<IncidentRemediationDecisionResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "deny" }),
    startIncidentDelivery: (id) => command<StartIncidentDeliveryResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/delivery`, "POST", {}),
    getIncidentDelivery: async (id) => readJson<GetIncidentDeliveryResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/delivery`)),
    approveIncidentDelivery: (id, approvalId) => command<IncidentDeliveryDecisionResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/delivery/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "approve" }),
    denyIncidentDelivery: (id, approvalId) => command<IncidentDeliveryDecisionResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/delivery/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "deny" }),
    start: (input) => command<StartInvestigationResponse>(`${baseUrl}/api/investigations`, "POST", input),
    get: async (id) => readJson<GetInvestigationResponse>(await request(investigationUrl(id))),
    cancel: (id) => command<CancelInvestigationResponse>(investigationUrl(id), "DELETE"),
    startInvestigation: (input) => command<StartInvestigationResponse>(`${baseUrl}/api/investigations`, "POST", input),
    getInvestigation: async (id) => readJson<GetInvestigationResponse>(await request(investigationUrl(id))),
    cancelInvestigation: (id) => command<CancelInvestigationResponse>(investigationUrl(id), "DELETE"),
    approve: (id, approvalId, answers) => command<ApprovalDecisionResponse>(`${investigationUrl(id)}/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "approve", ...(answers ? { answers } : {}) }),
    deny: (id, approvalId) => command<ApprovalDecisionResponse>(`${investigationUrl(id)}/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "deny" }),
    subscribeEvents(id, subscribeOptions = {}) {
      return streamSse<InvestigationEvent>(request, `${investigationUrl(id)}/events`, subscribeOptions, "Podo event stream")
    },
  }
}

async function* streamSse<T>(
  request: NonNullable<PodoClientOptions["fetch"]>,
  url: string,
  options: SubscribeEventsOptions,
  label: string,
): AsyncGenerator<T> {
  const response = await request(url, {
    headers: { accept: "text/event-stream", "last-event-id": String(options.afterSequence ?? 0) },
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok || !response.body) {
    const detail = await response.text()
    throw new Error(`${label} failed (${response.status}): ${detail}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      buffer = buffer.replaceAll("\r\n", "\n")
      let boundary: number
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
        if (data) yield JSON.parse(data) as T
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
