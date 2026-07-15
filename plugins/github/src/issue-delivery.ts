import { createHash } from "node:crypto"

export interface GitHubIssueDeliveryAuthorization {
  decision: "approved"
  approvalId: string
  approvedBy: string
  approvedAt: string
}

export type GitHubIssueRemediationFailureCode =
  | "execution_failed"
  | "invalid_executor_result"
  | "verification_failed"
  | "policy_denied"

export interface GitHubIssueDeliveryArtifactContent {
  incidentId: string
  remediationId: string
  title: string
  body: string
  evidenceIds: string[]
  remediationFailureCode: GitHubIssueRemediationFailureCode
}

export interface GitHubIssueDeliveryArtifact {
  id: string
  idempotencyKey: string
  contentSha256: string
  content: GitHubIssueDeliveryArtifactContent
}

export interface GitHubIssueDeliveryRequest {
  authorization: GitHubIssueDeliveryAuthorization
  artifact: GitHubIssueDeliveryArtifact
}

export interface GitHubIssueDeliveryResult {
  status: "created" | "existing"
  repository: { owner: string; name: string }
  issue: {
    number: number
    url: string
    state: "open" | "closed"
  }
  artifact: {
    id: string
    idempotencyKey: string
    contentSha256: string
    evidenceIds: string[]
    remediationFailureCode: GitHubIssueRemediationFailureCode
  }
  authorization: {
    approvalId: string
    approvedBy: string
    approvedAt: string
  }
}

export type GitHubIssueDeliveryErrorCode =
  | "invalid_delivery_config"
  | "authorization_required"
  | "invalid_authorization"
  | "invalid_artifact"
  | "artifact_hash_mismatch"
  | "artifact_identity_conflict"
  | "github_read_failed"
  | "github_write_failed"
  | "invalid_github_response"

export class GitHubIssueDeliveryError extends Error {
  constructor(readonly code: GitHubIssueDeliveryErrorCode) {
    super(code)
    this.name = "GitHubIssueDeliveryError"
  }
}

export type GitHubIssueFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface GitHubIssueDeliveryAdapterConfig {
  token: string
  repository: { owner: string; name: string }
  fetch?: GitHubIssueFetch
  apiBaseUrl?: string
}

interface ValidatedIssueDelivery {
  authorization: GitHubIssueDeliveryAuthorization
  artifact: GitHubIssueDeliveryArtifact
  marker: string
  expectedBody: string
  key: string
}

interface GitHubIssueResponse {
  number: number
  state: "open" | "closed"
  title: string
  body: string
}

export class GitHubIssueDeliveryAdapter {
  private readonly token: string
  private readonly repository: { owner: string; name: string }
  private readonly request: GitHubIssueFetch
  private readonly apiBaseUrl: string
  private readonly pending = new Map<string, Promise<GitHubIssueDeliveryResult>>()
  private readonly artifactHashes = new Map<string, string>()

  constructor(config: GitHubIssueDeliveryAdapterConfig) {
    if (!isPlainObject(config)
      || !isBoundedText(config.token, 8_192)
      || !isPlainObject(config.repository)
      || !hasExactKeys(config.repository, ["owner", "name"])
      || !isRepositoryPart(config.repository.owner, 39)
      || !isRepositoryPart(config.repository.name, 100)
      || (config.fetch !== undefined && typeof config.fetch !== "function")
      || (config.apiBaseUrl !== undefined && config.apiBaseUrl !== "https://api.github.com")) throw issueError("invalid_delivery_config")
    this.token = config.token
    this.repository = { owner: config.repository.owner, name: config.repository.name }
    this.request = config.fetch ?? globalThis.fetch
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com"
  }

  async deliver(request: GitHubIssueDeliveryRequest): Promise<GitHubIssueDeliveryResult> {
    const delivery = this.validateDelivery(request)
    const identity = `${delivery.artifact.idempotencyKey}:${delivery.artifact.contentSha256}`
    const knownIdentity = this.artifactHashes.get(delivery.artifact.id)
    if (knownIdentity && knownIdentity !== identity) throw issueError("artifact_identity_conflict")
    this.artifactHashes.set(delivery.artifact.id, identity)

    const pending = this.pending.get(delivery.key)
    if (pending) return copy(await pending)
    const operation = this.performDelivery(delivery)
    this.pending.set(delivery.key, operation)
    try {
      return copy(await operation)
    } finally {
      this.pending.delete(delivery.key)
    }
  }

  private validateDelivery(value: unknown): ValidatedIssueDelivery {
    if (!isPlainObject(value) || !hasExactKeys(value, ["authorization", "artifact"])) {
      if (isPlainObject(value) && value.authorization === undefined) throw issueError("authorization_required")
      throw issueError("invalid_artifact")
    }
    if (!isAuthorization(value.authorization)) throw issueError("invalid_authorization")
    if (!isArtifact(value.artifact)) throw issueError("invalid_artifact")
    const authorization = copy(value.authorization)
    const artifact = copy(value.artifact)
    if (computeIssueArtifactSha256(artifact.content) !== artifact.contentSha256) {
      throw issueError("artifact_hash_mismatch")
    }
    if (containsToken({ authorization, artifact }, this.token)) throw issueError("invalid_artifact")
    const marker = issueMarker(artifact)
    return {
      authorization,
      artifact,
      marker,
      expectedBody: `${artifact.content.body}\n\n${marker}`,
      key: `${this.repository.owner}/${this.repository.name}:${artifact.idempotencyKey}:${artifact.id}:${artifact.contentSha256}`,
    }
  }

  private async performDelivery(delivery: ValidatedIssueDelivery): Promise<GitHubIssueDeliveryResult> {
    const existing = await this.findExisting(delivery)
    if (existing) return this.toResult("existing", existing, delivery)

    let response: Response
    try {
      response = await this.githubFetch(this.issuesUrl(), {
        method: "POST",
        body: JSON.stringify({ title: delivery.artifact.content.title, body: delivery.expectedBody }),
      }, "write")
    } catch {
      const reconciled = await this.findExisting(delivery)
      if (reconciled) return this.toResult("existing", reconciled, delivery)
      throw issueError("github_write_failed")
    }
    if (response.status !== 201) {
      if (response.status === 422) {
        const reconciled = await this.findExisting(delivery)
        if (reconciled) return this.toResult("existing", reconciled, delivery)
      }
      throw issueError("github_write_failed")
    }
    const created = await parseIssueResponse(response)
    if (!created
      || created.title !== delivery.artifact.content.title
      || created.body !== delivery.expectedBody) throw issueError("invalid_github_response")
    return this.toResult("created", created, delivery)
  }

  private async findExisting(delivery: ValidatedIssueDelivery): Promise<GitHubIssueResponse | null> {
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({ state: "all", per_page: "100", page: String(page) })
      const response = await this.githubFetch(`${this.issuesUrl()}?${query}`, {}, "read")
      if (!response.ok) throw issueError("github_read_failed")
      const issues = await parseIssueList(response)
      if (!issues) throw issueError("invalid_github_response")
      for (const issue of issues) {
        const marker = parseIssueMarker(issue.body, delivery.artifact.idempotencyKey)
        if (!marker) continue
        if (marker.draftId !== delivery.artifact.id || marker.contentSha256 !== delivery.artifact.contentSha256) {
          throw issueError("artifact_identity_conflict")
        }
        if (issue.title !== delivery.artifact.content.title || issue.body !== delivery.expectedBody) {
          throw issueError("artifact_identity_conflict")
        }
        return issue
      }
      if (issues.length < 100) return null
    }
    throw issueError("github_read_failed")
  }

  private async githubFetch(url: string, init: RequestInit, operation: "read" | "write"): Promise<Response> {
    try {
      return await this.request(url, {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "x-github-api-version": "2022-11-28",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
      })
    } catch {
      throw issueError(operation === "read" ? "github_read_failed" : "github_write_failed")
    }
  }

  private issuesUrl(): string {
    return `${this.apiBaseUrl}/repos/${encodeURIComponent(this.repository.owner)}/${encodeURIComponent(this.repository.name)}/issues`
  }

  private toResult(
    status: "created" | "existing",
    issue: GitHubIssueResponse,
    delivery: ValidatedIssueDelivery,
  ): GitHubIssueDeliveryResult {
    return {
      status,
      repository: copy(this.repository),
      issue: {
        number: issue.number,
        url: `https://github.com/${this.repository.owner}/${this.repository.name}/issues/${issue.number}`,
        state: issue.state,
      },
      artifact: {
        id: delivery.artifact.id,
        idempotencyKey: delivery.artifact.idempotencyKey,
        contentSha256: delivery.artifact.contentSha256,
        evidenceIds: [...delivery.artifact.content.evidenceIds],
        remediationFailureCode: delivery.artifact.content.remediationFailureCode,
      },
      authorization: {
        approvalId: delivery.authorization.approvalId,
        approvedBy: delivery.authorization.approvedBy,
        approvedAt: delivery.authorization.approvedAt,
      },
    }
  }
}

export function computeIssueArtifactSha256(content: GitHubIssueDeliveryArtifactContent): string {
  return createHash("sha256").update(JSON.stringify({
    incidentId: content.incidentId,
    remediationId: content.remediationId,
    title: content.title,
    body: content.body,
    evidenceIds: [...content.evidenceIds],
    remediationFailureCode: content.remediationFailureCode,
  })).digest("hex")
}

function issueMarker(artifact: GitHubIssueDeliveryArtifact): string {
  return `<!-- podo-issue idempotency-key="${artifact.idempotencyKey}" draft-id="${artifact.id}" content-sha256="${artifact.contentSha256}" -->`
}

function parseIssueMarker(body: string, idempotencyKey: string): { draftId: string; contentSha256: string } | null {
  const pattern = /<!-- podo-issue idempotency-key="([A-Za-z0-9._:-]+)" draft-id="([A-Za-z0-9._:-]+)" content-sha256="([a-f0-9]{64})" -->/g
  for (const match of body.matchAll(pattern)) {
    if (match[1] === idempotencyKey && match[2] && match[3]) return { draftId: match[2], contentSha256: match[3] }
  }
  return null
}

async function parseIssueList(response: Response): Promise<GitHubIssueResponse[] | null> {
  try {
    const value = await response.json()
    if (!Array.isArray(value)) return null
    const issues: GitHubIssueResponse[] = []
    for (const item of value) {
      if (isPlainObject(item) && item.pull_request !== undefined) continue
      const parsed = parseIssue(item)
      if (!parsed) return null
      issues.push(parsed)
    }
    return issues
  } catch {
    return null
  }
}

async function parseIssueResponse(response: Response): Promise<GitHubIssueResponse | null> {
  try {
    return parseIssue(await response.json())
  } catch {
    return null
  }
}

function parseIssue(value: unknown): GitHubIssueResponse | null {
  if (!isPlainObject(value)
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || (value.state !== "open" && value.state !== "closed")
    || !isBoundedText(value.title, 300)
    || typeof value.body !== "string"
    || value.body.length === 0
    || value.body.length > 65_536
    || typeof value.html_url !== "string") return null
  return { number: value.number as number, state: value.state, title: value.title, body: value.body }
}

function isAuthorization(value: unknown): value is GitHubIssueDeliveryAuthorization {
  return isPlainObject(value)
    && hasExactKeys(value, ["decision", "approvalId", "approvedBy", "approvedAt"])
    && value.decision === "approved"
    && isIdentifier(value.approvalId)
    && isBoundedText(value.approvedBy, 320)
    && isIsoInstant(value.approvedAt)
}

function isArtifact(value: unknown): value is GitHubIssueDeliveryArtifact {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["id", "idempotencyKey", "contentSha256", "content"])
    || !isIdentifier(value.id)
    || !isIdentifier(value.idempotencyKey)
    || !isSha256(value.contentSha256)
    || !isPlainObject(value.content)) return false
  const content = value.content
  return hasExactKeys(content, ["incidentId", "remediationId", "title", "body", "evidenceIds", "remediationFailureCode"])
    && isIdentifier(content.incidentId)
    && isIdentifier(content.remediationId)
    && isBoundedText(content.title, 300)
    && typeof content.body === "string"
    && content.body.length > 0
    && content.body.length <= 60_000
    && isStringList(content.evidenceIds, 1, 500, 256)
    && ["execution_failed", "invalid_executor_result", "verification_failed", "policy_denied"].includes(String(content.remediationFailureCode))
}

function isStringList(value: unknown, minimum: number, maximum: number, itemLimit: number): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((item) => isBoundedText(item, itemLimit))
    && new Set(value).size === value.length
    && value.every((item, index) => index === 0 || value[index - 1]! < item)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !value.includes("\0")
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
}

function isRepositoryPart(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== ".."
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function containsToken(value: unknown, token: string): boolean {
  if (typeof value === "string") return value.includes(token)
  if (Array.isArray(value)) return value.some((item) => containsToken(item, token))
  if (isPlainObject(value)) return Object.values(value).some((item) => containsToken(item, token))
  return false
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

function issueError(code: GitHubIssueDeliveryErrorCode): GitHubIssueDeliveryError {
  return new GitHubIssueDeliveryError(code)
}
