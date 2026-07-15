import { createHash } from "node:crypto"
import type { PluginManifest } from "@podo/plugin-sdk"
import type { GitCliBranchPublisher, PublishedVerifiedBranch } from "./git-branch-publisher"

export {
  GitHubIssueDeliveryAdapter,
  GitHubIssueDeliveryError,
  computeIssueArtifactSha256,
} from "./issue-delivery"
export type {
  GitHubIssueDeliveryAdapterConfig,
  GitHubIssueDeliveryArtifact,
  GitHubIssueDeliveryArtifactContent,
  GitHubIssueDeliveryAuthorization,
  GitHubIssueDeliveryErrorCode,
  GitHubIssueDeliveryRequest,
  GitHubIssueDeliveryResult,
  GitHubIssueFetch,
  GitHubIssueRemediationFailureCode,
} from "./issue-delivery"

export { GitCliBranchPublisher, GitCliBranchPublisherError } from "./git-branch-publisher"
export type {
  GitCliBranchPublisherConfig,
  GitCliBranchPublisherErrorCode,
  GitCommandRunner,
  GitCommandRunnerInput,
  GitCommandRunnerResult,
  PublishedVerifiedBranch,
  PublishVerifiedBranchInput,
} from "./git-branch-publisher"

export const githubPluginManifest = {
  id: "podo.github",
  displayName: "GitHub",
  version: "0.0.0",
  capabilities: ["repository_read", "issue_write", "pull_request_write"],
} as const satisfies PluginManifest

export interface GitHubRepositoryTarget {
  owner: string
  name: string
  defaultBranch: string
  trustedBaseRef: string
}

export interface GitHubDeliveryAuthorization {
  decision: "approved"
  approvalId: string
  approvedBy: string
  approvedAt: string
}

export interface GitHubDeliveryArtifactContent {
  patch: {
    summary: string
    changedFiles: string[]
    unifiedDiff: string
    sha256: string
  }
  validation: {
    status: "passed" | "failed"
    checks: string[]
  }
  evidenceIds: string[]
  baseCommit: string
  resultTreeOid: string
  title: string
  body: string
  baseRef: string
  headRef: string
}

export interface GitHubDeliveryArtifact {
  id: string
  idempotencyKey: string
  contentSha256: string
  content: GitHubDeliveryArtifactContent
}

export interface GitHubDeliveryRequest {
  authorization: GitHubDeliveryAuthorization
  artifact: GitHubDeliveryArtifact
}

export interface GitHubBranchPublisherInput {
  repository: { owner: string; name: string }
  baseRef: string
  headRef: string
  approvedAt: string
  artifact: GitHubDeliveryArtifact
}

export interface GitHubBranchPublisherResult {
  headSha: string
  resultTreeOid: string
  artifactId: string
  contentSha256: string
  baseCommit: string
}

export interface GitHubBranchPublisher {
  publish(input: GitHubBranchPublisherInput): Promise<GitHubBranchPublisherResult>
}

export class GitCliDeliveryBranchPublisher implements GitHubBranchPublisher {
  constructor(
    private readonly publisher: Pick<GitCliBranchPublisher, "publish">,
    private readonly binding: {
      repository: { owner: string; name: string }
      baseRef: string
    },
  ) {}

  async publish(input: GitHubBranchPublisherInput): Promise<GitHubBranchPublisherResult> {
    if (input.repository.owner !== this.binding.repository.owner
      || input.repository.name !== this.binding.repository.name
      || input.baseRef !== this.binding.baseRef) throw error("publisher_binding_mismatch")
    const result: PublishedVerifiedBranch = await this.publisher.publish({
      baseCommit: input.artifact.content.baseCommit,
      unifiedDiff: input.artifact.content.patch.unifiedDiff,
      patchSha256: input.artifact.content.patch.sha256,
      changedFiles: [...input.artifact.content.patch.changedFiles],
      resultTreeOid: input.artifact.content.resultTreeOid,
      headBranch: input.headRef,
      commitMessage: input.artifact.content.title,
      commitTimestamp: new Date(input.approvedAt).toISOString(),
    })
    return {
      headSha: result.headCommit,
      resultTreeOid: result.resultTreeOid,
      artifactId: input.artifact.id,
      contentSha256: input.artifact.contentSha256,
      baseCommit: input.artifact.content.baseCommit,
    }
  }
}

export interface GitHubDeliveryResult {
  status: "created" | "existing"
  repository: { owner: string; name: string }
  pullRequest: {
    number: number
    url: string
    state: "open" | "closed"
    baseRef: string
    headRef: string
    headSha: string
  }
  artifact: {
    id: string
    idempotencyKey: string
    contentSha256: string
    patchSha256: string
    baseCommit: string
    resultTreeOid: string
    validationChecks: string[]
    evidenceIds: string[]
  }
  authorization: {
    approvalId: string
    approvedBy: string
    approvedAt: string
  }
}

export type GitHubDeliveryErrorCode =
  | "invalid_delivery_config"
  | "authorization_required"
  | "invalid_authorization"
  | "invalid_artifact"
  | "artifact_hash_mismatch"
  | "artifact_identity_conflict"
  | "patch_hash_mismatch"
  | "validation_failed"
  | "untrusted_base_branch"
  | "unsafe_head_branch"
  | "publisher_binding_mismatch"
  | "branch_publish_failed"
  | "invalid_publisher_result"
  | "github_read_failed"
  | "github_write_failed"
  | "invalid_github_response"

export class GitHubDeliveryError extends Error {
  constructor(readonly code: GitHubDeliveryErrorCode) {
    super(code)
    this.name = "GitHubDeliveryError"
  }
}

export interface GitHubDeliveryAdapterConfig {
  token: string
  repository: GitHubRepositoryTarget
  publisher: GitHubBranchPublisher
  fetch?: GitHubFetch
  apiBaseUrl?: string
}

export type GitHubFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface ValidatedDelivery {
  authorization: GitHubDeliveryAuthorization
  artifact: GitHubDeliveryArtifact
  marker: string
  key: string
}

interface GitHubPullResponse {
  number: number
  html_url: string
  state: "open" | "closed"
  title: string
  body: string | null
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
}

export class GitHubDeliveryAdapter {
  private readonly token: string
  private readonly repository: GitHubRepositoryTarget
  private readonly publisher: GitHubBranchPublisher
  private readonly request: GitHubFetch
  private readonly apiBaseUrl: string
  private readonly pending = new Map<string, Promise<GitHubDeliveryResult>>()
  private readonly artifactHashes = new Map<string, string>()

  constructor(config: GitHubDeliveryAdapterConfig) {
    const validated = validateConfig(config)
    this.token = validated.token
    this.repository = validated.repository
    this.publisher = validated.publisher
    this.request = validated.fetch ?? globalThis.fetch
    this.apiBaseUrl = validated.apiBaseUrl ?? "https://api.github.com"
  }

  async deliver(request: GitHubDeliveryRequest): Promise<GitHubDeliveryResult> {
    const delivery = this.validateDelivery(request)
    const identity = `${delivery.artifact.idempotencyKey}:${delivery.artifact.contentSha256}`
    const knownIdentity = this.artifactHashes.get(delivery.artifact.id)
    if (knownIdentity && knownIdentity !== identity) throw error("artifact_identity_conflict")
    this.artifactHashes.set(delivery.artifact.id, identity)

    const pending = this.pending.get(delivery.key)
    if (pending) return copy(await pending)

    const operation = this.performDelivery(delivery)
    this.pending.set(delivery.key, operation)
    try {
      const result = await operation
      return copy(result)
    } finally {
      this.pending.delete(delivery.key)
    }
  }

  private validateDelivery(value: unknown): ValidatedDelivery {
    if (!isPlainObject(value)) throw error("authorization_required")
    const authorization = value.authorization
    if (authorization === undefined || authorization === null) throw error("authorization_required")
    if (!isAuthorization(authorization)) throw error("invalid_authorization")
    if (!isArtifact(value.artifact)) throw error("invalid_artifact")
    const artifact = copy(value.artifact)
    const content = artifact.content
    if (content.validation.status !== "passed") throw error("validation_failed")
    if (content.baseRef !== this.repository.trustedBaseRef) throw error("untrusted_base_branch")
    if (content.headRef === this.repository.defaultBranch
      || content.headRef === this.repository.trustedBaseRef
      || !isDerivedHeadBranch(content.headRef)) throw error("unsafe_head_branch")
    const patchHash = computePatchSha256(content.patch.unifiedDiff)
    if (patchHash !== content.patch.sha256) throw error("patch_hash_mismatch")
    const contentHash = computeDeliveryArtifactSha256(content)
    if (contentHash !== artifact.contentSha256) throw error("artifact_hash_mismatch")
    if (containsToken({ authorization, artifact }, this.token)) throw error("invalid_artifact")
    const marker = idempotencyMarker(artifact)
    return {
      authorization: copy(authorization),
      artifact,
      marker,
      key: `${this.repository.owner}/${this.repository.name}:${artifact.idempotencyKey}:${artifact.id}:${artifact.contentSha256}`,
    }
  }

  private async performDelivery(delivery: ValidatedDelivery): Promise<GitHubDeliveryResult> {
    let published: GitHubBranchPublisherResult
    try {
      published = await this.publisher.publish({
        repository: { owner: this.repository.owner, name: this.repository.name },
        baseRef: delivery.artifact.content.baseRef,
        headRef: delivery.artifact.content.headRef,
        approvedAt: delivery.authorization.approvedAt,
        artifact: copy(delivery.artifact),
      })
    } catch {
      throw error("branch_publish_failed")
    }
    if (!isPlainObject(published)
      || !isCommitSha(published.headSha)
      || published.resultTreeOid !== delivery.artifact.content.resultTreeOid
      || published.artifactId !== delivery.artifact.id
      || published.contentSha256 !== delivery.artifact.contentSha256
      || published.baseCommit !== delivery.artifact.content.baseCommit) throw error("invalid_publisher_result")

    const existing = await this.findExisting(delivery, published.headSha)
    if (existing) return this.toResult("existing", existing, delivery)

    const response = await this.githubFetch(this.pullsUrl(), {
      method: "POST",
      body: JSON.stringify({
        title: delivery.artifact.content.title,
        body: expectedPullBody(delivery),
        head: delivery.artifact.content.headRef,
        base: delivery.artifact.content.baseRef,
        maintainer_can_modify: false,
      }),
    }, "write")
    if (response.status === 422) {
      const concurrent = await this.findExisting(delivery, published.headSha)
      if (concurrent) return this.toResult("existing", concurrent, delivery)
      throw error("github_write_failed")
    }
    if (response.status !== 201) throw error("github_write_failed")
    const created = await parsePullResponse(response)
    if (!created
      || created.title !== delivery.artifact.content.title
      || created.body !== expectedPullBody(delivery)
      || created.base.ref !== delivery.artifact.content.baseRef
      || created.base.sha !== delivery.artifact.content.baseCommit
      || created.head.ref !== delivery.artifact.content.headRef
      || created.head.sha !== published.headSha) throw error("invalid_github_response")
    return this.toResult("created", created, delivery)
  }

  private async findExisting(delivery: ValidatedDelivery, expectedHeadSha: string): Promise<GitHubPullResponse | null> {
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({
        state: "all",
        head: `${this.repository.owner}:${delivery.artifact.content.headRef}`,
        base: delivery.artifact.content.baseRef,
        per_page: "100",
        page: String(page),
      })
      const response = await this.githubFetch(`${this.pullsUrl()}?${query}`, {}, "read")
      if (!response.ok) throw error("github_read_failed")
      const pulls = await parsePullList(response)
      if (!pulls) throw error("invalid_github_response")
      for (const pull of pulls) {
        const marker = pull.body ? parseMarker(pull.body, delivery.artifact.idempotencyKey) : null
        if (!marker) continue
        if (marker.artifactId !== delivery.artifact.id || marker.contentSha256 !== delivery.artifact.contentSha256) {
          throw error("artifact_identity_conflict")
        }
        if (pull.base.ref !== delivery.artifact.content.baseRef || pull.head.ref !== delivery.artifact.content.headRef) continue
        if (pull.base.sha !== delivery.artifact.content.baseCommit
          || pull.head.sha !== expectedHeadSha
          || pull.title !== delivery.artifact.content.title
          || pull.body !== expectedPullBody(delivery)) throw error("artifact_identity_conflict")
        return pull
      }
      if (pulls.length < 100) return null
    }
    throw error("github_read_failed")
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
      throw error(operation === "read" ? "github_read_failed" : "github_write_failed")
    }
  }

  private pullsUrl(): string {
    return `${this.apiBaseUrl}/repos/${encodeURIComponent(this.repository.owner)}/${encodeURIComponent(this.repository.name)}/pulls`
  }

  private toResult(
    status: "created" | "existing",
    pull: GitHubPullResponse,
    delivery: ValidatedDelivery,
  ): GitHubDeliveryResult {
    return {
      status,
      repository: { owner: this.repository.owner, name: this.repository.name },
      pullRequest: {
        number: pull.number,
        url: sanitizeUrl(pull.html_url, this.token, this.repository, pull.number),
        state: pull.state,
        baseRef: pull.base.ref,
        headRef: pull.head.ref,
        headSha: pull.head.sha,
      },
      artifact: {
        id: delivery.artifact.id,
        idempotencyKey: delivery.artifact.idempotencyKey,
        contentSha256: delivery.artifact.contentSha256,
        patchSha256: delivery.artifact.content.patch.sha256,
        baseCommit: delivery.artifact.content.baseCommit,
        resultTreeOid: delivery.artifact.content.resultTreeOid,
        validationChecks: [...delivery.artifact.content.validation.checks],
        evidenceIds: [...delivery.artifact.content.evidenceIds],
      },
      authorization: {
        approvalId: delivery.authorization.approvalId,
        approvedBy: delivery.authorization.approvedBy,
        approvedAt: delivery.authorization.approvedAt,
      },
    }
  }
}

export function computePatchSha256(unifiedDiff: string): string {
  return createHash("sha256").update(unifiedDiff).digest("hex")
}

export function computeDeliveryArtifactSha256(content: GitHubDeliveryArtifactContent): string {
  const canonical = {
    patch: {
      summary: content.patch.summary,
      changedFiles: [...content.patch.changedFiles],
      unifiedDiff: content.patch.unifiedDiff,
      sha256: content.patch.sha256,
    },
    validation: { status: content.validation.status, checks: [...content.validation.checks] },
    evidenceIds: [...content.evidenceIds],
    baseCommit: content.baseCommit,
    resultTreeOid: content.resultTreeOid,
    title: content.title,
    body: content.body,
    baseRef: content.baseRef,
    headRef: content.headRef,
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

function validateConfig(config: GitHubDeliveryAdapterConfig): GitHubDeliveryAdapterConfig {
  try {
    if (!config || typeof config !== "object") throw new Error()
    if (!isBoundedText(config.token, 8_192)) throw new Error()
    if (!isRepository(config.repository)) throw new Error()
    if (containsToken(config.repository, config.token)) throw new Error()
    if (!config.publisher || typeof config.publisher.publish !== "function") throw new Error()
    if (config.fetch !== undefined && typeof config.fetch !== "function") throw new Error()
    if (config.apiBaseUrl !== undefined && config.apiBaseUrl !== "https://api.github.com") throw new Error()
    const result: GitHubDeliveryAdapterConfig = {
      token: config.token,
      repository: { ...config.repository },
      publisher: config.publisher,
      ...(config.fetch ? { fetch: config.fetch } : {}),
      ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
    }
    return result
  } catch {
    throw error("invalid_delivery_config")
  }
}

function isRepository(value: unknown): value is GitHubRepositoryTarget {
  return isPlainObject(value)
    && hasExactKeys(value, ["owner", "name", "defaultBranch", "trustedBaseRef"])
    && isRepositoryPart(value.owner)
    && isRepositoryPart(value.name)
    && isBranch(value.defaultBranch)
    && isBranch(value.trustedBaseRef)
}

function isAuthorization(value: unknown): value is GitHubDeliveryAuthorization {
  return isPlainObject(value)
    && hasExactKeys(value, ["decision", "approvalId", "approvedBy", "approvedAt"])
    && value.decision === "approved"
    && isIdentifier(value.approvalId)
    && isBoundedText(value.approvedBy, 320)
    && isIsoInstant(value.approvedAt)
}

function isArtifact(value: unknown): value is GitHubDeliveryArtifact {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["id", "idempotencyKey", "contentSha256", "content"])
    || !isIdentifier(value.id)
    || !isIdentifier(value.idempotencyKey)
    || !isSha256(value.contentSha256)
    || !isPlainObject(value.content)) return false
  const content = value.content
  return hasExactKeys(content, ["patch", "validation", "evidenceIds", "baseCommit", "resultTreeOid", "title", "body", "baseRef", "headRef"])
    && isPatch(content.patch)
    && isValidation(content.validation)
    && isStringList(content.evidenceIds, 1, 500, 256)
    && isCommitSha(content.baseCommit)
    && isCommitSha(content.resultTreeOid)
    && content.resultTreeOid.length === content.baseCommit.length
    && isBoundedText(content.title, 300)
    && isBoundedText(content.body, 20_000)
    && isBranch(content.baseRef)
    && isBranch(content.headRef)
}

function isPatch(value: unknown): value is GitHubDeliveryArtifactContent["patch"] {
  return isPlainObject(value)
    && hasExactKeys(value, ["summary", "changedFiles", "unifiedDiff", "sha256"])
    && isBoundedText(value.summary, 500)
    && isStringList(value.changedFiles, 1, 100, 512, isSafePath)
    && isBoundedRaw(value.unifiedDiff, 512 * 1024)
    && value.unifiedDiff.startsWith("diff --git ")
    && isSha256(value.sha256)
}

function isValidation(value: unknown): value is GitHubDeliveryArtifactContent["validation"] {
  return isPlainObject(value)
    && hasExactKeys(value, ["status", "checks"])
    && (value.status === "passed" || value.status === "failed")
    && isStringList(value.checks, 1, 100, 500)
}

function isStringList(
  value: unknown,
  minimum: number,
  maximum: number,
  itemLimit: number,
  predicate: (value: string) => boolean = () => true,
): value is string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return false
  if (!value.every((item) => isBoundedText(item, itemLimit) && predicate(item))) return false
  if (new Set(value).size !== value.length) return false
  return value.every((item, index) => index === 0 || compareCodeUnits(value[index - 1]!, item) < 0)
}

async function parsePullList(response: Response): Promise<GitHubPullResponse[] | null> {
  try {
    const value = await response.json()
    if (!Array.isArray(value)) return null
    const parsed: GitHubPullResponse[] = []
    for (const item of value) {
      const pull = parsePull(item)
      if (!pull) return null
      parsed.push(pull)
    }
    return parsed
  } catch {
    return null
  }
}

async function parsePullResponse(response: Response): Promise<GitHubPullResponse | null> {
  try {
    return parsePull(await response.json())
  } catch {
    return null
  }
}

function parsePull(value: unknown): GitHubPullResponse | null {
  if (!isPlainObject(value)
    || !Number.isSafeInteger(value.number)
    || (value.number as number) < 1
    || typeof value.html_url !== "string"
    || (value.state !== "open" && value.state !== "closed")
    || !isBoundedText(value.title, 300)
    || (value.body !== null && typeof value.body !== "string")
    || !isPlainObject(value.base)
    || !isBranch(value.base.ref)
    || !isCommitSha(value.base.sha)
    || !isPlainObject(value.head)
    || !isBranch(value.head.ref)
    || !isCommitSha(value.head.sha)) return null
  return value as unknown as GitHubPullResponse
}

function expectedPullBody(delivery: ValidatedDelivery): string {
  return `${delivery.artifact.content.body.trim()}\n\n${delivery.marker}`
}

function idempotencyMarker(artifact: GitHubDeliveryArtifact): string {
  return `<!-- podo-delivery:${artifact.idempotencyKey}:${artifact.id}:${artifact.contentSha256} -->`
}

function parseMarker(body: string, idempotencyKey: string): { artifactId: string; contentSha256: string } | null {
  const escapedKey = idempotencyKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = body.match(new RegExp(`<!-- podo-delivery:${escapedKey}:([A-Za-z0-9][A-Za-z0-9._:-]{0,199}):([a-f0-9]{64}) -->`))
  return match?.[1] && match[2] ? { artifactId: match[1], contentSha256: match[2] } : null
}

function sanitizeUrl(value: string, token: string, repository: GitHubRepositoryTarget, number: number): string {
  try {
    const url = new URL(value)
    if (url.origin !== "https://github.com"
      || url.pathname !== `/${repository.owner}/${repository.name}/pull/${number}`
      || url.username
      || url.password
      || url.search
      || url.hash
      || value.includes(token)
      || value.length > 2_048) throw new Error()
    return url.toString()
  } catch {
    throw error("invalid_github_response")
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

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !value.includes("\0")
}

function isBoundedRaw(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0")
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
}

function isRepositoryPart(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
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

function isSafePath(value: string): boolean {
  return !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((segment) => /^[A-Za-z0-9._@+-]+$/.test(segment) && segment !== "." && segment !== "..")
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
}

function isDerivedHeadBranch(value: unknown): value is string {
  return typeof value === "string"
    && /^podo\/remediation-[a-f0-9]{16,64}$/.test(value)
    && isBranch(value)
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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

function error(code: GitHubDeliveryErrorCode): GitHubDeliveryError {
  return new GitHubDeliveryError(code)
}
