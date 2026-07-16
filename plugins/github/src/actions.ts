import { createHmac, timingSafeEqual } from "node:crypto"

import {
  DEFAULT_GITHUB_REQUEST_TIMEOUT_MS,
  fetchWithGitHubTimeout,
  isGitHubRequestTimeout,
} from "./request-timeout"

const GITHUB_API_ORIGIN = "https://api.github.com"
const GITHUB_WEB_ORIGIN = "https://github.com"
const GITHUB_API_VERSION = "2022-11-28"
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_PAGES = 10
const PAGE_SIZE = 100

export interface GitHubActionsRepository {
  owner: string
  name: string
}

export type GitHubActionsRunStatus =
  | "requested"
  | "queued"
  | "pending"
  | "waiting"
  | "in_progress"
  | "completed"

export type GitHubActionsConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "success"
  | "timed_out"

export interface GitHubActionsStepSnapshot {
  number: number
  name: string
  status: GitHubActionsRunStatus
  conclusion: GitHubActionsConclusion | null
  startedAt: string | null
  completedAt: string | null
}

export interface GitHubActionsJobSnapshot {
  id: number
  runId: number
  attempt: number
  headSha: string
  name: string
  status: "completed"
  conclusion: GitHubActionsConclusion
  startedAt: string | null
  completedAt: string | null
  steps: GitHubActionsStepSnapshot[]
}

export interface GitHubActionsRunSnapshot {
  id: number
  workflowId: number
  workflowName: string
  workflowPath: string
  runNumber: number
  attempt: number
  event: string
  headBranch: string | null
  headSha: string
  status: GitHubActionsRunStatus
  conclusion: GitHubActionsConclusion | null
  createdAt: string
  updatedAt: string
  url: string
}

export interface GitHubActionsWebhookSignal {
  provider: "github"
  event: "workflow_run"
  action: "completed"
  deliveryId: string
  repository: GitHubActionsRepository
  run: {
    id: number
    attempt: number
    headSha: string
  }
}

export interface GitHubActionsFailureSnapshot {
  schemaVersion: "podo.github-actions.failure.v1"
  deliveryId: string
  repository: GitHubActionsRepository
  run: GitHubActionsRunSnapshot & { status: "completed"; conclusion: "failure" }
  jobs: GitHubActionsJobSnapshot[]
}

export interface GitHubActionsRunBinding {
  repository: GitHubActionsRepository
  runId: number
  headSha: string
}

export interface GitHubActionsWorkflowRunListRequest {
  repository: GitHubActionsRepository
  headSha: string
}

export interface GitHubActionsRunsForHead {
  repository: GitHubActionsRepository
  headSha: string
  runs: GitHubActionsRunSnapshot[]
}

export interface GitHubActionsWebhookDecoderConfig {
  secret: string
  repository: GitHubActionsRepository
}

export interface GitHubActionsWebhookInput {
  eventType: string
  deliveryId: string
  signatureSha256: string
  body: string
}

export interface GitHubActionsReadAdapterConfig {
  token: string
  repository: GitHubActionsRepository
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  apiBaseUrl?: string
  requestTimeoutMs?: number
}

export interface GitHubActionsRetryAuthorization {
  kind: "core.github_actions_retry.v1"
  decision: "approved"
  approvalId: string
  approvedBy: string
  approvedAt: string
}

export interface GitHubActionsRetryRequest {
  authorization: GitHubActionsRetryAuthorization
  incidentId: string
  idempotencyKey: string
  repository: GitHubActionsRepository
  run: {
    id: number
    headSha: string
    attempt: number
  }
}

export interface GitHubActionsRetryResult {
  status: "accepted" | "existing"
  repository: GitHubActionsRepository
  incidentId: string
  idempotencyKey: string
  run: {
    id: number
    headSha: string
    previousAttempt: number
  }
  authorization: {
    approvalId: string
    approvedBy: string
    approvedAt: string
  }
}

export type GitHubActionsRetryAdapterConfig = GitHubActionsReadAdapterConfig

export type GitHubActionsErrorCode =
  | "invalid_actions_config"
  | "invalid_webhook_input"
  | "webhook_signature_required"
  | "invalid_webhook_signature"
  | "unsupported_webhook_event"
  | "invalid_webhook_payload"
  | "repository_mismatch"
  | "invalid_read_request"
  | "run_binding_mismatch"
  | "not_failed_completed_run"
  | "github_read_failed"
  | "invalid_github_response"
  | "retry_authorization_required"
  | "invalid_retry_authorization"
  | "invalid_retry_request"
  | "retry_identity_conflict"
  | "github_write_failed"

export class GitHubActionsError extends Error {
  constructor(readonly code: GitHubActionsErrorCode) {
    super(code)
    this.name = "GitHubActionsError"
  }
}

export class GitHubActionsWebhookDecoder {
  private readonly secret: string
  private readonly repository: GitHubActionsRepository

  constructor(config: GitHubActionsWebhookDecoderConfig) {
    if (!isPlainObject(config)
      || !hasExactKeys(config, ["secret", "repository"])
      || !isBoundedText(config.secret, 8_192)
      || !isRepository(config.repository)
      || containsValue(config.repository, config.secret)) throw failure("invalid_actions_config")
    this.secret = config.secret
    this.repository = { ...config.repository }
  }

  decode(value: unknown): GitHubActionsWebhookSignal {
    if (!isPlainObject(value)) throw failure("invalid_webhook_input")
    if (!("signatureSha256" in value) || value.signatureSha256 === null || value.signatureSha256 === "") {
      throw failure("webhook_signature_required")
    }
    if (!hasExactKeys(value, ["eventType", "deliveryId", "signatureSha256", "body"])
      || typeof value.body !== "string"
      || Buffer.byteLength(value.body, "utf8") > MAX_WEBHOOK_BYTES
      || !isIdentifier(value.deliveryId)
      || containsValue(value.deliveryId, this.secret)) throw failure("invalid_webhook_input")
    if (typeof value.signatureSha256 !== "string" || !/^sha256=[a-f0-9]{64}$/.test(value.signatureSha256)) {
      throw failure("invalid_webhook_signature")
    }
    const expected = `sha256=${createHmac("sha256", this.secret).update(value.body).digest("hex")}`
    const suppliedBytes = Buffer.from(value.signatureSha256, "utf8")
    const expectedBytes = Buffer.from(expected, "utf8")
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw failure("invalid_webhook_signature")
    }
    if (value.eventType !== "workflow_run") throw failure("unsupported_webhook_event")

    const payload = parseJsonText(value.body)
    if (!isPlainObject(payload)
      || payload.action !== "completed"
      || !matchesRepositoryPayload(payload.repository, this.repository)
      || !isPlainObject(payload.workflow_run)
      || !isPositiveInteger(payload.workflow_run.id)
      || !isPositiveInteger(payload.workflow_run.run_attempt)
      || !isCommitSha(payload.workflow_run.head_sha)
      || payload.workflow_run.status !== "completed"
      || payload.workflow_run.conclusion !== "failure"
      || containsValue(payload.workflow_run.head_sha, this.secret)) {
      if (isPlainObject(payload) && payload.repository !== undefined
        && !matchesRepositoryPayload(payload.repository, this.repository)) throw failure("repository_mismatch")
      throw failure("invalid_webhook_payload")
    }

    return {
      provider: "github",
      event: "workflow_run",
      action: "completed",
      deliveryId: value.deliveryId,
      repository: { ...this.repository },
      run: {
        id: payload.workflow_run.id,
        attempt: payload.workflow_run.run_attempt,
        headSha: payload.workflow_run.head_sha,
      },
    }
  }
}

export class GitHubActionsReadAdapter {
  private readonly token: string
  private readonly repository: GitHubActionsRepository
  private readonly request: NonNullable<GitHubActionsReadAdapterConfig["fetch"]>
  private readonly apiBaseUrl: string
  private readonly requestTimeoutMs: number

  constructor(config: GitHubActionsReadAdapterConfig) {
    const validated = validateAdapterConfig(config)
    this.token = validated.token
    this.repository = { ...validated.repository }
    this.request = validated.fetch ?? globalThis.fetch
    this.apiBaseUrl = validated.apiBaseUrl ?? GITHUB_API_ORIGIN
    this.requestTimeoutMs = validated.requestTimeoutMs ?? DEFAULT_GITHUB_REQUEST_TIMEOUT_MS
  }

  async captureFailedRun(value: unknown): Promise<GitHubActionsFailureSnapshot> {
    const signal = validateSignal(value, this.repository, this.token)
    const run = await this.readRun(signal.run.id)
    if (run.id !== signal.run.id || run.headSha !== signal.run.headSha || run.attempt !== signal.run.attempt) {
      throw failure("run_binding_mismatch")
    }
    if (run.status !== "completed" || run.conclusion !== "failure") {
      throw failure("not_failed_completed_run")
    }
    const jobs = await this.readAttemptJobs(run.id, run.attempt, run.headSha)
    if (!jobs.some((job) => job.conclusion === "failure"
      || job.steps.some((step) => step.conclusion === "failure"))) {
      throw failure("invalid_github_response")
    }
    return {
      schemaVersion: "podo.github-actions.failure.v1",
      deliveryId: signal.deliveryId,
      repository: { ...this.repository },
      run: { ...run, status: "completed", conclusion: "failure" },
      jobs,
    }
  }

  async getCurrentRun(value: unknown): Promise<GitHubActionsRunSnapshot> {
    const binding = validateRunBinding(value, this.repository, this.token)
    const run = await this.readRun(binding.runId)
    if (run.id !== binding.runId || run.headSha !== binding.headSha) throw failure("run_binding_mismatch")
    return run
  }

  async listRunsForHead(value: unknown): Promise<GitHubActionsRunsForHead> {
    const input = validateListRequest(value, this.repository, this.token)
    const runs: GitHubActionsRunSnapshot[] = []
    let expectedTotal: number | null = null

    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({ head_sha: input.headSha, per_page: String(PAGE_SIZE), page: String(page) })
      const response = await this.readJson(`${this.runsUrl()}?${query}`)
      if (!isPlainObject(response)
        || !Number.isSafeInteger(response.total_count)
        || (response.total_count as number) < 0
        || (response.total_count as number) > MAX_PAGES * PAGE_SIZE
        || !Array.isArray(response.workflow_runs)
        || response.workflow_runs.length > PAGE_SIZE) throw failure("invalid_github_response")
      expectedTotal ??= response.total_count as number
      if (response.total_count !== expectedTotal) throw failure("invalid_github_response")
      for (const item of response.workflow_runs) {
        const run = parseRun(item, this.repository, this.token)
        if (!run || run.headSha !== input.headSha) throw failure("invalid_github_response")
        runs.push(run)
      }
      if (runs.length >= expectedTotal) break
      if (response.workflow_runs.length === 0) throw failure("invalid_github_response")
    }

    if (expectedTotal === null || runs.length !== expectedTotal || hasDuplicate(runs.map(({ id }) => id))) {
      throw failure("invalid_github_response")
    }
    runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id)
    return { repository: { ...this.repository }, headSha: input.headSha, runs }
  }

  private async readRun(runId: number): Promise<GitHubActionsRunSnapshot> {
    const value = await this.readJson(`${this.runsUrl()}/${runId}`)
    const run = parseRun(value, this.repository, this.token)
    if (!run) throw failure("invalid_github_response")
    return run
  }

  private async readAttemptJobs(runId: number, attempt: number, headSha: string): Promise<GitHubActionsJobSnapshot[]> {
    const jobs: GitHubActionsJobSnapshot[] = []
    let expectedTotal: number | null = null

    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) })
      const url = `${this.runsUrl()}/${runId}/attempts/${attempt}/jobs?${query}`
      const response = await this.readJson(url)
      if (!isPlainObject(response)
        || !Number.isSafeInteger(response.total_count)
        || (response.total_count as number) < 1
        || (response.total_count as number) > MAX_PAGES * PAGE_SIZE
        || !Array.isArray(response.jobs)
        || response.jobs.length > PAGE_SIZE) throw failure("invalid_github_response")
      expectedTotal ??= response.total_count as number
      if (response.total_count !== expectedTotal) throw failure("invalid_github_response")
      for (const item of response.jobs) {
        const job = parseJob(item, runId, attempt, headSha, this.token)
        if (!job) throw failure("invalid_github_response")
        jobs.push(job)
      }
      if (jobs.length >= expectedTotal) break
      if (response.jobs.length === 0) throw failure("invalid_github_response")
    }

    if (expectedTotal === null || jobs.length !== expectedTotal || hasDuplicate(jobs.map(({ id }) => id))) {
      throw failure("invalid_github_response")
    }
    jobs.sort((left, right) => left.id - right.id)
    return jobs
  }

  private async readJson(url: string): Promise<unknown> {
    let response: Response
    try {
      response = await fetchWithGitHubTimeout(
        this.request,
        url,
        { headers: githubHeaders(this.token) },
        this.requestTimeoutMs,
      )
    } catch {
      throw failure("github_read_failed")
    }
    if (!response.ok) throw failure("github_read_failed")
    try {
      const body = await response.text()
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error()
      return JSON.parse(body) as unknown
    } catch {
      throw failure("invalid_github_response")
    }
  }

  private runsUrl(): string {
    return `${this.apiBaseUrl}/repos/${encodeURIComponent(this.repository.owner)}/${encodeURIComponent(this.repository.name)}/actions/runs`
  }
}

export class GitHubActionsRetryAdapter {
  private readonly token: string
  private readonly repository: GitHubActionsRepository
  private readonly request: NonNullable<GitHubActionsRetryAdapterConfig["fetch"]>
  private readonly apiBaseUrl: string
  private readonly requestTimeoutMs: number
  private readonly reader: GitHubActionsReadAdapter
  private readonly pending = new Map<string, Promise<GitHubActionsRetryResult>>()
  private readonly completed = new Map<string, GitHubActionsRetryResult>()
  private readonly identities = new Map<string, string>()

  constructor(config: GitHubActionsRetryAdapterConfig) {
    const validated = validateAdapterConfig(config)
    this.token = validated.token
    this.repository = { ...validated.repository }
    this.request = validated.fetch ?? globalThis.fetch
    this.apiBaseUrl = validated.apiBaseUrl ?? GITHUB_API_ORIGIN
    this.requestTimeoutMs = validated.requestTimeoutMs ?? DEFAULT_GITHUB_REQUEST_TIMEOUT_MS
    this.reader = new GitHubActionsReadAdapter(validated)
  }

  async retryFailedJobs(value: unknown): Promise<GitHubActionsRetryResult> {
    const request = validateRetryRequest(value, this.repository, this.token)
    const identity = JSON.stringify({
      incidentId: request.incidentId,
      repository: request.repository,
      run: request.run,
      authorization: request.authorization,
    })
    const known = this.identities.get(request.idempotencyKey)
    if (known !== undefined && known !== identity) throw failure("retry_identity_conflict")
    this.identities.set(request.idempotencyKey, identity)

    const completed = this.completed.get(request.idempotencyKey)
    if (completed) return { ...copy(completed), status: "existing" }
    const pending = this.pending.get(request.idempotencyKey)
    if (pending) return copy(await pending)

    const operation = this.performRetry(request)
    this.pending.set(request.idempotencyKey, operation)
    try {
      const result = await operation
      this.completed.set(request.idempotencyKey, copy(result))
      return copy(result)
    } finally {
      this.pending.delete(request.idempotencyKey)
    }
  }

  private async performRetry(request: GitHubActionsRetryRequest): Promise<GitHubActionsRetryResult> {
    const current = await this.reader.getCurrentRun({
      repository: request.repository,
      runId: request.run.id,
      headSha: request.run.headSha,
    })
    if (current.attempt !== request.run.attempt) throw failure("run_binding_mismatch")
    if (current.status !== "completed" || current.conclusion !== "failure") {
      throw failure("not_failed_completed_run")
    }

    let response: Response
    try {
      response = await fetchWithGitHubTimeout(
        this.request,
        `${this.runsUrl()}/${request.run.id}/rerun-failed-jobs`,
        {
          method: "POST",
          headers: githubHeaders(this.token, true),
          body: JSON.stringify({ enable_debug_logging: false }),
        },
        this.requestTimeoutMs,
      )
    } catch {
      throw failure("github_write_failed")
    }
    if (response.status !== 201) throw failure("github_write_failed")
    return {
      status: "accepted",
      repository: { ...this.repository },
      incidentId: request.incidentId,
      idempotencyKey: request.idempotencyKey,
      run: {
        id: request.run.id,
        headSha: request.run.headSha,
        previousAttempt: request.run.attempt,
      },
      authorization: {
        approvalId: request.authorization.approvalId,
        approvedBy: request.authorization.approvedBy,
        approvedAt: request.authorization.approvedAt,
      },
    }
  }

  private runsUrl(): string {
    return `${this.apiBaseUrl}/repos/${encodeURIComponent(this.repository.owner)}/${encodeURIComponent(this.repository.name)}/actions/runs`
  }
}

function validateAdapterConfig<T extends GitHubActionsReadAdapterConfig>(config: T): T {
  if (!isPlainObject(config)
    || !isBoundedText(config.token, 8_192)
    || !isRepository(config.repository)
    || containsValue(config.repository, config.token)
    || (config.fetch !== undefined && typeof config.fetch !== "function")
    || (config.apiBaseUrl !== undefined && config.apiBaseUrl !== GITHUB_API_ORIGIN)
    || (config.requestTimeoutMs !== undefined && !isGitHubRequestTimeout(config.requestTimeoutMs))) {
    throw failure("invalid_actions_config")
  }
  return config
}

function validateSignal(
  value: unknown,
  repository: GitHubActionsRepository,
  token: string,
): GitHubActionsWebhookSignal {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["provider", "event", "action", "deliveryId", "repository", "run"])
    || value.provider !== "github"
    || value.event !== "workflow_run"
    || value.action !== "completed"
    || !isIdentifier(value.deliveryId)
    || !sameRepository(value.repository, repository)
    || !isPlainObject(value.run)
    || !hasExactKeys(value.run, ["id", "attempt", "headSha"])
    || !isPositiveInteger(value.run.id)
    || !isPositiveInteger(value.run.attempt)
    || !isCommitSha(value.run.headSha)
    || containsValue(value, token)) throw failure("invalid_read_request")
  return copy(value as unknown as GitHubActionsWebhookSignal)
}

function validateRunBinding(
  value: unknown,
  repository: GitHubActionsRepository,
  token: string,
): GitHubActionsRunBinding {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["repository", "runId", "headSha"])
    || !sameRepository(value.repository, repository)
    || !isPositiveInteger(value.runId)
    || !isCommitSha(value.headSha)
    || containsValue(value, token)) throw failure("invalid_read_request")
  return copy(value as unknown as GitHubActionsRunBinding)
}

function validateListRequest(
  value: unknown,
  repository: GitHubActionsRepository,
  token: string,
): GitHubActionsWorkflowRunListRequest {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["repository", "headSha"])
    || !sameRepository(value.repository, repository)
    || !isCommitSha(value.headSha)
    || containsValue(value, token)) throw failure("invalid_read_request")
  return copy(value as unknown as GitHubActionsWorkflowRunListRequest)
}

function validateRetryRequest(
  value: unknown,
  repository: GitHubActionsRepository,
  token: string,
): GitHubActionsRetryRequest {
  if (!isPlainObject(value)) throw failure("retry_authorization_required")
  if (value.authorization === undefined || value.authorization === null) {
    throw failure("retry_authorization_required")
  }
  if (!isRetryAuthorization(value.authorization)) throw failure("invalid_retry_authorization")
  if (!hasExactKeys(value, ["authorization", "incidentId", "idempotencyKey", "repository", "run"])
    || !isIdentifier(value.incidentId)
    || !isIdentifier(value.idempotencyKey)
    || !sameRepository(value.repository, repository)
    || !isPlainObject(value.run)
    || !hasExactKeys(value.run, ["id", "headSha", "attempt"])
    || !isPositiveInteger(value.run.id)
    || !isCommitSha(value.run.headSha)
    || !isPositiveInteger(value.run.attempt)
    || containsValue(value, token)) throw failure("invalid_retry_request")
  return copy(value as unknown as GitHubActionsRetryRequest)
}

function isRetryAuthorization(value: unknown): value is GitHubActionsRetryAuthorization {
  return isPlainObject(value)
    && hasExactKeys(value, ["kind", "decision", "approvalId", "approvedBy", "approvedAt"])
    && value.kind === "core.github_actions_retry.v1"
    && value.decision === "approved"
    && isIdentifier(value.approvalId)
    && isBoundedText(value.approvedBy, 320)
    && isIsoInstant(value.approvedAt)
}

function parseRun(
  value: unknown,
  repository: GitHubActionsRepository,
  token: string,
): GitHubActionsRunSnapshot | null {
  if (!isPlainObject(value)
    || !isPositiveInteger(value.id)
    || !isPositiveInteger(value.workflow_id)
    || !isBoundedText(value.name, 300)
    || !isBoundedText(value.path, 512)
    || !isPositiveInteger(value.run_number)
    || !isPositiveInteger(value.run_attempt)
    || !isBoundedText(value.event, 100)
    || (value.head_branch !== null && !isBranch(value.head_branch))
    || !isCommitSha(value.head_sha)
    || !isRunStatus(value.status)
    || (value.conclusion !== null && !isConclusion(value.conclusion))
    || !isIsoInstant(value.created_at)
    || !isIsoInstant(value.updated_at)
    || !matchesRepositoryPayload(value.repository, repository)
    || !isExactRunUrl(value.html_url, repository, value.id)
    || containsValue(value, token)) return null
  return {
    id: value.id,
    workflowId: value.workflow_id,
    workflowName: value.name,
    workflowPath: value.path,
    runNumber: value.run_number,
    attempt: value.run_attempt,
    event: value.event,
    headBranch: value.head_branch,
    headSha: value.head_sha,
    status: value.status,
    conclusion: value.conclusion,
    createdAt: canonicalInstant(value.created_at),
    updatedAt: canonicalInstant(value.updated_at),
    url: value.html_url,
  }
}

function parseJob(
  value: unknown,
  runId: number,
  attempt: number,
  headSha: string,
  token: string,
): GitHubActionsJobSnapshot | null {
  if (!isPlainObject(value)
    || !isPositiveInteger(value.id)
    || value.run_id !== runId
    || (value.run_attempt !== undefined && value.run_attempt !== attempt)
    || value.head_sha !== headSha
    || !isBoundedText(value.name, 300)
    || value.status !== "completed"
    || !isConclusion(value.conclusion)
    || !isNullableIsoInstant(value.started_at)
    || !isNullableIsoInstant(value.completed_at)
    || (value.steps !== undefined && value.steps !== null && !Array.isArray(value.steps))
    || containsValue(value, token)) return null
  const rawSteps = Array.isArray(value.steps) ? value.steps : []
  if (rawSteps.length > 500) return null
  const steps: GitHubActionsStepSnapshot[] = []
  for (const item of rawSteps) {
    const step = parseStep(item)
    if (!step) return null
    steps.push(step)
  }
  steps.sort((left, right) => left.number - right.number)
  if (hasDuplicate(steps.map(({ number }) => number))) return null
  return {
    id: value.id,
    runId,
    attempt,
    headSha,
    name: value.name,
    status: "completed",
    conclusion: value.conclusion,
    startedAt: canonicalNullableInstant(value.started_at),
    completedAt: canonicalNullableInstant(value.completed_at),
    steps,
  }
}

function parseStep(value: unknown): GitHubActionsStepSnapshot | null {
  if (!isPlainObject(value)
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || !isBoundedText(value.name, 300)
    || !isRunStatus(value.status)
    || (value.conclusion !== null && !isConclusion(value.conclusion))
    || !isNullableIsoInstant(value.started_at)
    || !isNullableIsoInstant(value.completed_at)) return null
  return {
    number: value.number as number,
    name: value.name,
    status: value.status,
    conclusion: value.conclusion,
    startedAt: canonicalNullableInstant(value.started_at),
    completedAt: canonicalNullableInstant(value.completed_at),
  }
}

function githubHeaders(token: string, json = false): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
    ...(json ? { "content-type": "application/json" } : {}),
  }
}

function matchesRepositoryPayload(value: unknown, repository: GitHubActionsRepository): boolean {
  return isPlainObject(value)
    && value.full_name === `${repository.owner}/${repository.name}`
    && value.name === repository.name
    && isPlainObject(value.owner)
    && value.owner.login === repository.owner
}

function sameRepository(value: unknown, repository: GitHubActionsRepository): value is GitHubActionsRepository {
  return isPlainObject(value)
    && hasExactKeys(value, ["owner", "name"])
    && value.owner === repository.owner
    && value.name === repository.name
}

function isRepository(value: unknown): value is GitHubActionsRepository {
  return isPlainObject(value)
    && hasExactKeys(value, ["owner", "name"])
    && isRepositoryPart(value.owner, 39)
    && isRepositoryPart(value.name, 100)
}

function isRepositoryPart(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    && value !== ".."
}

function isExactRunUrl(value: unknown, repository: GitHubActionsRepository, runId: number): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false
  try {
    const url = new URL(value)
    return url.origin === GITHUB_WEB_ORIGIN
      && url.pathname === `/${repository.owner}/${repository.name}/actions/runs/${runId}`
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function isRunStatus(value: unknown): value is GitHubActionsRunStatus {
  return value === "requested"
    || value === "queued"
    || value === "pending"
    || value === "waiting"
    || value === "in_progress"
    || value === "completed"
}

function isConclusion(value: unknown): value is GitHubActionsConclusion {
  return value === "action_required"
    || value === "cancelled"
    || value === "failure"
    || value === "neutral"
    || value === "skipped"
    || value === "stale"
    || value === "success"
    || value === "timed_out"
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
}

function isBranch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".")
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !value.includes("\0")
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function isNullableIsoInstant(value: unknown): value is string | null {
  return value === null || isIsoInstant(value)
}

function canonicalInstant(value: string): string {
  return new Date(value).toISOString()
}

function canonicalNullableInstant(value: string | null): string | null {
  return value === null ? null : canonicalInstant(value)
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function containsValue(value: unknown, secret: string): boolean {
  if (typeof value === "string") return value.includes(secret)
  if (Array.isArray(value)) return value.some((item) => containsValue(item, secret))
  if (isPlainObject(value)) return Object.values(value).some((item) => containsValue(item, secret))
  return false
}

function hasDuplicate(values: readonly number[]): boolean {
  return new Set(values).size !== values.length
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

function failure(code: GitHubActionsErrorCode): GitHubActionsError {
  return new GitHubActionsError(code)
}
