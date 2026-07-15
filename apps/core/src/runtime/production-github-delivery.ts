import { isAbsolute, relative, resolve } from "node:path"

import {
  GitCliBranchPublisher,
  GitCliDeliveryBranchPublisher,
  GitHubDeliveryAdapter,
  GitHubIssueDeliveryAdapter,
  computeDeliveryArtifactSha256,
  computeIssueArtifactSha256,
  type GitCliBranchPublisherConfig,
  type GitHubDeliveryAdapterConfig,
  type GitHubDeliveryArtifactContent,
  type GitHubDeliveryRequest,
  type GitHubDeliveryResult,
  type GitHubIssueDeliveryAdapterConfig,
  type GitHubIssueDeliveryArtifactContent,
  type GitHubIssueDeliveryRequest,
  type GitHubIssueDeliveryResult,
} from "@podo/plugin-github"

import type {
  PullRequestDeliveryConfig,
  PullRequestDeliveryInput,
  PullRequestDeliveryPort,
} from "../modules/remediation/incident-delivery"
import type {
  IssueDeliveryConfig,
  IssueDeliveryInput,
  IssueDeliveryPort,
} from "../modules/remediation/incident-issue-delivery"

type Environment = Readonly<Record<string, string | undefined>>

interface ProductionGitHubDeliveryConfig {
  token: string
  owner: string
  repository: string
  defaultBranch: string
  operatorIdentity: string
  repositoryRoot: string
  scratchParent: string
  remoteName: string
  commandTimeoutMs: number
  maxOutputBytes: number
}

type ConcretePublisher = Pick<GitCliBranchPublisher, "publish">
type ConcreteAdapter = Pick<GitHubDeliveryAdapter, "deliver">
type ConcreteIssueAdapter = Pick<GitHubIssueDeliveryAdapter, "deliver">

export interface ProductionGitHubDeliveryDependencies {
  createPublisher?: (config: GitCliBranchPublisherConfig) => ConcretePublisher
  createAdapter?: (config: GitHubDeliveryAdapterConfig) => ConcreteAdapter
  createIssueAdapter?: (config: GitHubIssueDeliveryAdapterConfig) => ConcreteIssueAdapter
}

export function createProductionGitHubIssueDelivery(
  environment: Environment,
  dependencies: ProductionGitHubDeliveryDependencies = {},
): IssueDeliveryConfig | undefined {
  const config = parseConfig(environment)
  if (!config) return undefined

  try {
    const createAdapter = dependencies.createIssueAdapter ?? ((value) => new GitHubIssueDeliveryAdapter(value))
    const adapter = createAdapter({
      token: config.token,
      repository: { owner: config.owner, name: config.repository },
    })
    return {
      expectedRepository: `${config.owner}/${config.repository}`,
      port: new ProductionGitHubIssueDeliveryPort(adapter, config.operatorIdentity),
    }
  } catch {
    throw invalidConfig()
  }
}

export class ProductionGitHubDeliveryConfigError extends Error {
  readonly code = "invalid_production_github_delivery_config"

  constructor() {
    super("invalid_production_github_delivery_config")
    this.name = "ProductionGitHubDeliveryConfigError"
  }
}

export function createProductionGitHubPullRequestDelivery(
  environment: Environment,
  dependencies: ProductionGitHubDeliveryDependencies = {},
): PullRequestDeliveryConfig | undefined {
  const config = parseConfig(environment)
  if (!config) return undefined

  try {
    const createPublisher = dependencies.createPublisher ?? ((value) => new GitCliBranchPublisher(value))
    const publisher = createPublisher({
      repositoryRoot: config.repositoryRoot,
      scratchParent: config.scratchParent,
      remoteName: config.remoteName,
      owner: config.owner,
      repository: config.repository,
      defaultBranch: config.defaultBranch,
      token: config.token,
      commandTimeoutMs: config.commandTimeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    })
    const deliveryPublisher = new GitCliDeliveryBranchPublisher(publisher, {
      repository: { owner: config.owner, name: config.repository },
      baseRef: config.defaultBranch,
    })
    const createAdapter = dependencies.createAdapter ?? ((value) => new GitHubDeliveryAdapter(value))
    const adapter = createAdapter({
      token: config.token,
      repository: {
        owner: config.owner,
        name: config.repository,
        defaultBranch: config.defaultBranch,
        trustedBaseRef: config.defaultBranch,
      },
      publisher: deliveryPublisher,
    })
    const expectedRepository = `${config.owner}/${config.repository}`
    return {
      expectedRepository,
      port: new ProductionGitHubDeliveryPort(adapter, config.operatorIdentity),
    }
  } catch {
    throw invalidConfig()
  }
}

class ProductionGitHubDeliveryPort implements PullRequestDeliveryPort {
  constructor(
    private readonly adapter: ConcreteAdapter,
    private readonly operatorIdentity: string,
  ) {}

  async deliver(input: PullRequestDeliveryInput): Promise<unknown> {
    const request = toGitHubRequest(input, this.operatorIdentity)
    const result = await this.adapter.deliver(request)
    return toCoreResult(result)
  }
}

class ProductionGitHubIssueDeliveryPort implements IssueDeliveryPort {
  constructor(
    private readonly adapter: ConcreteIssueAdapter,
    private readonly operatorIdentity: string,
  ) {}

  async deliver(input: IssueDeliveryInput): Promise<unknown> {
    const request = toGitHubIssueRequest(input, this.operatorIdentity)
    const result = await this.adapter.deliver(request)
    return toCoreIssueResult(result)
  }
}

function toGitHubRequest(input: PullRequestDeliveryInput, operatorIdentity: string): GitHubDeliveryRequest {
  const artifact = input.artifact
  const content: GitHubDeliveryArtifactContent = {
    patch: {
      summary: artifact.patch.summary,
      changedFiles: [...artifact.patch.changedFiles],
      unifiedDiff: artifact.patch.unifiedDiff,
      sha256: artifact.patch.sha256,
    },
    validation: {
      status: artifact.validation.status,
      checks: [...artifact.validation.checks],
    },
    evidenceIds: [...artifact.evidenceIds],
    baseCommit: artifact.provenance.baseCommit,
    resultTreeOid: artifact.provenance.resultTreeOid,
    title: artifact.pullRequestPreview.title,
    body: artifact.pullRequestPreview.body,
    baseRef: artifact.pullRequestPreview.baseBranch,
    headRef: artifact.pullRequestPreview.headBranch,
  }
  return {
    authorization: {
      decision: "approved",
      approvalId: input.authorization.approvalId,
      approvedBy: operatorIdentity,
      approvedAt: input.authorization.approvedAt,
    },
    artifact: {
      id: artifact.pullRequestPreview.id,
      idempotencyKey: input.deliveryId,
      contentSha256: computeDeliveryArtifactSha256(content),
      content,
    },
  }
}

function toCoreResult(result: GitHubDeliveryResult): unknown {
  return {
    provider: "github",
    repository: `${result.repository.owner}/${result.repository.name}`,
    number: result.pullRequest.number,
    url: result.pullRequest.url,
    baseCommit: result.artifact.baseCommit,
    baseBranch: result.pullRequest.baseRef,
    headBranch: result.pullRequest.headRef,
    artifactId: result.artifact.id,
  }
}

function toGitHubIssueRequest(input: IssueDeliveryInput, operatorIdentity: string): GitHubIssueDeliveryRequest {
  const content: GitHubIssueDeliveryArtifactContent = {
    incidentId: input.incidentId,
    remediationId: input.remediationId,
    title: input.draft.title,
    body: input.draft.body,
    evidenceIds: [...input.draft.evidenceIds],
    remediationFailureCode: input.draft.remediationFailureCode,
  }
  return {
    authorization: {
      decision: "approved",
      approvalId: input.authorization.approvalId,
      approvedBy: operatorIdentity,
      approvedAt: input.authorization.approvedAt,
    },
    artifact: {
      id: input.draft.id,
      idempotencyKey: input.issueDeliveryId,
      contentSha256: computeIssueArtifactSha256(content),
      content,
    },
  }
}

function toCoreIssueResult(result: GitHubIssueDeliveryResult): unknown {
  return {
    provider: "github",
    repository: `${result.repository.owner}/${result.repository.name}`,
    number: result.issue.number,
    url: result.issue.url,
    draftId: result.artifact.id,
  }
}

function parseConfig(environment: Environment): ProductionGitHubDeliveryConfig | null {
  const enabled = environment.PODO_GITHUB_DELIVERY_ENABLED
  if (enabled === undefined || enabled === "false") return null
  if (enabled !== "true") throw invalidConfig()
  if (environment.PODO_REMEDIATION_ENABLED !== "true") throw invalidConfig()

  const token = required(environment, "PODO_GITHUB_TOKEN", 8_192)
  const [owner, repository, extra] = required(environment, "PODO_GITHUB_REPOSITORY", 201).split("/")
  const defaultBranch = required(environment, "PODO_GITHUB_DEFAULT_BRANCH", 255)
  const remediationBaseBranch = required(environment, "PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH", 255)
  const operatorIdentity = required(environment, "PODO_GITHUB_OPERATOR_IDENTITY", 320)
  const remoteName = required(environment, "PODO_GITHUB_REMOTE_NAME", 100)
  const repositoryRoot = required(environment, "PODO_REMEDIATION_REPOSITORY_ROOT", 4_096)
  const scratchParent = required(environment, "PODO_REMEDIATION_SCRATCH_PARENT", 4_096)
  const commandTimeoutMs = boundedInteger(environment.PODO_GITHUB_COMMAND_TIMEOUT_MS, 100, 300_000)
  const maxOutputBytes = boundedInteger(environment.PODO_GITHUB_MAX_OUTPUT_BYTES, 1_024, 512 * 1_024)

  if (!owner || !repository || extra !== undefined
    || !ownerPart(owner)
    || !repositoryPart(repository)
    || !safeBranch(defaultBranch)
    || remediationBaseBranch !== defaultBranch
    || !safeIdentity(operatorIdentity)
    || operatorIdentity.includes(token)
    || !safeRemote(remoteName)
    || !safeAbsolutePath(repositoryRoot)
    || !safeAbsolutePath(scratchParent)
    || pathsOverlap(repositoryRoot, scratchParent)) throw invalidConfig()

  return {
    token,
    owner,
    repository,
    defaultBranch,
    operatorIdentity,
    repositoryRoot,
    scratchParent,
    remoteName,
    commandTimeoutMs,
    maxOutputBytes,
  }
}

function required(environment: Environment, key: string, maximum: number): string {
  const value = environment[key]
  if (typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || value.includes("\0")) throw invalidConfig()
  return value
}

function boundedInteger(value: string | undefined, minimum: number, maximum: number): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) throw invalidConfig()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw invalidConfig()
  return parsed
}

function repositoryPart(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && value !== ".."
}

function ownerPart(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/.test(value) && value !== ".."
}

function safeBranch(value: string): boolean {
  return value.length <= 255
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.startsWith("refs/")
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".")
}

function safeIdentity(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/.test(value)
}

function safeRemote(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
}

function safeAbsolutePath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value
}

function pathsOverlap(left: string, right: string): boolean {
  const leftToRight = relative(left, right)
  const rightToLeft = relative(right, left)
  return leftToRight === "" || !leftToRight.startsWith("..") || !rightToLeft.startsWith("..")
}

function invalidConfig(): ProductionGitHubDeliveryConfigError {
  return new ProductionGitHubDeliveryConfigError()
}
