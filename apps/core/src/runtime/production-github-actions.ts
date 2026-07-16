import { isAbsolute, resolve } from "node:path"

import {
  GitHubActionsError,
  GitHubActionsReadAdapter,
  GitHubActionsRetryAdapter,
  GitHubActionsWebhookDecoder,
  type GitHubActionsFailureSnapshot,
  type GitHubActionsReadAdapterConfig,
  type GitHubActionsRepository,
  type GitHubActionsRetryAdapterConfig,
  type GitHubActionsRetryRequest,
  type GitHubActionsRetryResult,
  type GitHubActionsRunBinding,
  type GitHubActionsRunsForHead,
  type GitHubActionsRunSnapshot,
  type GitHubActionsWebhookDecoderConfig,
  type GitHubActionsWebhookInput,
  type GitHubActionsWebhookSignal,
  type GitHubActionsWorkflowRunListRequest,
} from "@podo/plugin-github"

type Environment = Readonly<Record<string, string | undefined>>
type ConcreteWebhookDecoder = Pick<GitHubActionsWebhookDecoder, "decode">
type ConcreteReadAdapter = Pick<GitHubActionsReadAdapter, "captureFailedRun" | "getCurrentRun" | "listRunsForHead">
type ConcreteRetryAdapter = Pick<GitHubActionsRetryAdapter, "retryFailedJobs">

interface ParsedProductionGitHubActionsConfig {
  token: string
  webhookSecret: string
  repository: GitHubActionsRepository
  repositoryCwd: string
  operatorIdentity: string
}

export interface ProductionGitHubActionsDependencies {
  createWebhookDecoder?: (config: GitHubActionsWebhookDecoderConfig) => ConcreteWebhookDecoder
  createReadAdapter?: (config: GitHubActionsReadAdapterConfig) => ConcreteReadAdapter
  createRetryAdapter?: (config: GitHubActionsRetryAdapterConfig) => ConcreteRetryAdapter
}

export interface ProductionGitHubActionsConfig {
  repository: GitHubActionsRepository
  repositoryCwd: string
  operatorIdentity: string
  decodeWebhook(input: GitHubActionsWebhookInput): GitHubActionsWebhookSignal
  captureFailedRun(signal: GitHubActionsWebhookSignal): Promise<GitHubActionsFailureSnapshot>
  getCurrentRun(binding: GitHubActionsRunBinding): Promise<GitHubActionsRunSnapshot>
  listRunsForHead(input: GitHubActionsWorkflowRunListRequest): Promise<GitHubActionsRunsForHead>
  retryFailedJobs(request: GitHubActionsRetryRequest): Promise<GitHubActionsRetryResult>
}

export class ProductionGitHubActionsConfigError extends Error {
  readonly code = "invalid_production_github_actions_config"

  constructor() {
    super("invalid_production_github_actions_config")
    this.name = "ProductionGitHubActionsConfigError"
  }
}

export type ProductionGitHubActionsOperation =
  | "decode_webhook"
  | "capture_failed_run"
  | "get_current_run"
  | "list_runs_for_head"
  | "retry_failed_jobs"

export class ProductionGitHubActionsOperationError extends Error {
  readonly code = "production_github_actions_operation_failed"

  constructor(readonly operation: ProductionGitHubActionsOperation) {
    super("production_github_actions_operation_failed")
    this.name = "ProductionGitHubActionsOperationError"
  }
}

export function createProductionGitHubActions(
  environment: Environment,
  dependencies: ProductionGitHubActionsDependencies = {},
): ProductionGitHubActionsConfig | undefined {
  const config = parseConfig(environment)
  if (!config) return undefined

  let decoder: ConcreteWebhookDecoder
  let reader: ConcreteReadAdapter
  let retry: ConcreteRetryAdapter
  try {
    const createWebhookDecoder = dependencies.createWebhookDecoder
      ?? ((value: GitHubActionsWebhookDecoderConfig) => new GitHubActionsWebhookDecoder(value))
    const createReadAdapter = dependencies.createReadAdapter
      ?? ((value: GitHubActionsReadAdapterConfig) => new GitHubActionsReadAdapter(value))
    const createRetryAdapter = dependencies.createRetryAdapter
      ?? ((value: GitHubActionsRetryAdapterConfig) => new GitHubActionsRetryAdapter(value))
    decoder = createWebhookDecoder({
      secret: config.webhookSecret,
      repository: { ...config.repository },
    })
    reader = createReadAdapter({
      token: config.token,
      repository: { ...config.repository },
    })
    retry = createRetryAdapter({
      token: config.token,
      repository: { ...config.repository },
    })
  } catch {
    throw invalidConfig()
  }

  return {
    repository: { ...config.repository },
    repositoryCwd: config.repositoryCwd,
    operatorIdentity: config.operatorIdentity,
    decodeWebhook(input) {
      return runSync("decode_webhook", () => decoder.decode(input))
    },
    captureFailedRun(signal) {
      return runAsync("capture_failed_run", () => reader.captureFailedRun(signal))
    },
    getCurrentRun(binding) {
      return runAsync("get_current_run", () => reader.getCurrentRun(binding))
    },
    listRunsForHead(input) {
      return runAsync("list_runs_for_head", () => reader.listRunsForHead(input))
    },
    retryFailedJobs(request) {
      return runAsync("retry_failed_jobs", () => retry.retryFailedJobs(request))
    },
  }
}

function parseConfig(environment: Environment): ParsedProductionGitHubActionsConfig | null {
  const enabled = environment.PODO_GITHUB_ACTIONS_ENABLED
  if (enabled === undefined || enabled === "false") return null
  if (enabled !== "true") throw invalidConfig()

  const token = required(environment.PODO_GITHUB_TOKEN, 8_192)
  const webhookSecret = required(environment.PODO_GITHUB_ACTIONS_WEBHOOK_SECRET, 8_192)
  const repositoryIdentity = required(environment.PODO_GITHUB_REPOSITORY, 201)
  const repositoryCwd = required(environment.PODO_GITHUB_ACTIONS_REPOSITORY_CWD, 4_096)
  const operatorIdentity = required(environment.PODO_GITHUB_OPERATOR_IDENTITY, 320)
  const [owner, name, extra] = repositoryIdentity.split("/")

  if (!owner
    || !name
    || extra !== undefined
    || !repositoryPart(owner, 39)
    || !repositoryPart(name, 100)
    || !safeAbsolutePath(repositoryCwd)
    || !safeIdentity(operatorIdentity)
    || token === webhookSecret
    || containsSecret(repositoryIdentity, token, webhookSecret)
    || containsSecret(repositoryCwd, token, webhookSecret)
    || containsSecret(operatorIdentity, token, webhookSecret)) throw invalidConfig()

  return {
    token,
    webhookSecret,
    repository: { owner, name },
    repositoryCwd,
    operatorIdentity,
  }
}

function required(value: string | undefined, maximum: number): string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || value.includes("\0")) throw invalidConfig()
  return value
}

function repositoryPart(value: string, maximum: number): boolean {
  return value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    && value !== ".."
}

function safeAbsolutePath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value && value !== "/"
}

function safeIdentity(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/.test(value)
}

function containsSecret(value: string, token: string, webhookSecret: string): boolean {
  return value.includes(token) || value.includes(webhookSecret)
}

function runSync<T>(operation: ProductionGitHubActionsOperation, run: () => T): T {
  try {
    return run()
  } catch (error) {
    throw sanitizeOperationError(operation, error)
  }
}

async function runAsync<T>(operation: ProductionGitHubActionsOperation, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw sanitizeOperationError(operation, error)
  }
}

function sanitizeOperationError(
  operation: ProductionGitHubActionsOperation,
  error: unknown,
): GitHubActionsError | ProductionGitHubActionsOperationError {
  if (error instanceof GitHubActionsError) return error
  return new ProductionGitHubActionsOperationError(operation)
}

function invalidConfig(): ProductionGitHubActionsConfigError {
  return new ProductionGitHubActionsConfigError()
}
