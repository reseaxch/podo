import type {
  ApprovalDecisionResponse,
  CancelInvestigationResponse,
  GetInvestigationResponse,
  GetIncidentCausalPathResponse,
  GetIncidentResponse,
  GetIncidentDeliveryResponse,
  GetIncidentIssueDeliveryResponse,
  GetIncidentRemediationAuditResponse,
  GetSettingsResponse,
  HealthResponse,
  IngestTelemetryResponse,
  GetIncidentRemediationResponse,
  IncidentRemediationDecisionResponse,
  IncidentDeliveryDecisionResponse,
  IncidentIssueDeliveryDecisionResponse,
  InvestigationEvent,
  ListIncidentsResponse,
  StartIncidentInvestigationRequest,
  StartIncidentInvestigationResponse,
  StartIncidentRemediationResponse,
  StartIncidentDeliveryResponse,
  StartIncidentIssueDeliveryResponse,
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

export interface PodoIncidentClient extends PodoClient {
  startIncidentInvestigation(id: string, input: StartIncidentInvestigationRequest): Promise<StartIncidentInvestigationResponse>
  getIncidentCausalPath(id: string, evidenceId: string): Promise<GetIncidentCausalPathResponse>
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
  startIncidentIssueDelivery(id: string): Promise<StartIncidentIssueDeliveryResponse>
  getIncidentIssueDelivery(id: string): Promise<GetIncidentIssueDeliveryResponse>
  approveIncidentIssueDelivery(id: string, approvalId: string): Promise<IncidentIssueDeliveryDecisionResponse>
  denyIncidentIssueDelivery(id: string, approvalId: string): Promise<IncidentIssueDeliveryDecisionResponse>
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Podo request failed (${response.status}): ${detail}`)
  }
  return (await response.json()) as T
}

export function createPodoClient(options: PodoClientOptions = {}): PodoIncidentClient & PodoRemediationClient {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:4100").replace(/\/$/, "")
  const request = options.fetch ?? globalThis.fetch
  const investigationUrl = (id: string) => `${baseUrl}/api/investigations/${encodeURIComponent(id)}`
  const command = async <T>(url: string, method: string, body?: unknown) => readJson<T>(await request(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }))

  return {
    health: async () => readJson<HealthResponse>(await request(`${baseUrl}/healthz`)),
    systemStatus: async () => readJson<SystemStatusResponse>(await request(`${baseUrl}/api/system`)),
    getSettings: async () => readJson<GetSettingsResponse>(await request(`${baseUrl}/api/settings`)),
    updateSettings: (input) => command<UpdateSettingsResponse>(`${baseUrl}/api/settings`, "PATCH", input),
    ingestTelemetry: (events) => command<IngestTelemetryResponse>(`${baseUrl}/api/telemetry/events`, "POST", { events }),
    listIncidents: async () => readJson<ListIncidentsResponse>(await request(`${baseUrl}/api/incidents`)),
    getIncident: async (id) => readJson<GetIncidentResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}`)),
    getIncidentCausalPath: async (id, evidenceId) => readJson<GetIncidentCausalPathResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/causal-path?evidenceId=${encodeURIComponent(evidenceId)}`)),
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
    startIncidentIssueDelivery: (id) => command<StartIncidentIssueDeliveryResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/issue-delivery`, "POST", {}),
    getIncidentIssueDelivery: async (id) => readJson<GetIncidentIssueDeliveryResponse>(await request(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/issue-delivery`)),
    approveIncidentIssueDelivery: (id, approvalId) => command<IncidentIssueDeliveryDecisionResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/issue-delivery/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "approve" }),
    denyIncidentIssueDelivery: (id, approvalId) => command<IncidentIssueDeliveryDecisionResponse>(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/remediation/issue-delivery/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "deny" }),
    start: (input) => command<StartInvestigationResponse>(`${baseUrl}/api/investigations`, "POST", input),
    get: async (id) => readJson<GetInvestigationResponse>(await request(investigationUrl(id))),
    cancel: (id) => command<CancelInvestigationResponse>(investigationUrl(id), "DELETE"),
    startInvestigation: (input) => command<StartInvestigationResponse>(`${baseUrl}/api/investigations`, "POST", input),
    getInvestigation: async (id) => readJson<GetInvestigationResponse>(await request(investigationUrl(id))),
    cancelInvestigation: (id) => command<CancelInvestigationResponse>(investigationUrl(id), "DELETE"),
    approve: (id, approvalId, answers) => command<ApprovalDecisionResponse>(`${investigationUrl(id)}/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "approve", ...(answers ? { answers } : {}) }),
    deny: (id, approvalId) => command<ApprovalDecisionResponse>(`${investigationUrl(id)}/approvals/${encodeURIComponent(approvalId)}`, "POST", { decision: "deny" }),
    subscribeEvents(id, subscribeOptions = {}) {
      return streamEvents(request, `${investigationUrl(id)}/events`, subscribeOptions)
    },
  }
}

async function* streamEvents(
  request: NonNullable<PodoClientOptions["fetch"]>,
  url: string,
  options: SubscribeEventsOptions,
): AsyncGenerator<InvestigationEvent> {
  const response = await request(url, {
    headers: { accept: "text/event-stream", "last-event-id": String(options.afterSequence ?? 0) },
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok || !response.body) {
    const detail = await response.text()
    throw new Error(`Podo event stream failed (${response.status}): ${detail}`)
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
        if (data) yield JSON.parse(data) as InvestigationEvent
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
