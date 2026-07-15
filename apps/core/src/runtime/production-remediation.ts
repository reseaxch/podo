import { isAbsolute, relative, resolve } from "node:path"

import type { CodexRuntime } from "@podo/codex-app-server-client"

import { CodexRemediationPatchProducer } from "../modules/remediation/codex-remediation-patch-producer"
import type {
  IncidentRemediationExecutor,
  IncidentRemediationExecutorInput,
} from "../modules/remediation/incident-remediation"
import {
  LocalWorktreeRemediationExecutor,
  type LocalWorktreeRemediationExecutorConfig,
  type RemediationPatchProducer,
} from "../modules/remediation/local-worktree-remediation-executor"

type Environment = Readonly<Record<string, string | undefined>>
type RuntimeProvider = () => Promise<CodexRuntime>
export type ProductionRemediationExecutorFactory = (runtimeProvider: RuntimeProvider) => IncidentRemediationExecutor

interface ProductionRemediationConfig {
  repositoryRoot: string
  trustedBaseRef: string
  pullRequestBaseBranch: string
  scratchParent: string
  regressionCommand: string[]
  validationCommands: string[][]
  commandTimeoutMs: number
  turnTimeoutMs: number
  maxOutputBytes: number
}

export interface ProductionRemediationDependencies {
  createProducer?: (config: { runtime: CodexRuntime; turnTimeoutMs: number }) => RemediationPatchProducer
  createExecutor?: (config: LocalWorktreeRemediationExecutorConfig) => IncidentRemediationExecutor
}

export class ProductionRemediationConfigError extends Error {
  readonly code = "invalid_production_remediation_config"

  constructor() {
    super("invalid_production_remediation_config")
    this.name = "ProductionRemediationConfigError"
  }
}

export function createProductionRemediationExecutor(
  environment: Environment,
  runtimeProvider: RuntimeProvider,
  dependencies: ProductionRemediationDependencies = {},
): IncidentRemediationExecutor | undefined {
  const config = parseConfig(environment)
  if (!config) return undefined
  if (typeof runtimeProvider !== "function") throw invalidConfig()

  return createConfiguredExecutor(config, runtimeProvider, dependencies)
}

export function createProductionRemediationExecutorFactory(
  environment: Environment,
  dependencies: ProductionRemediationDependencies = {},
): ProductionRemediationExecutorFactory | undefined {
  const config = parseConfig(environment)
  if (!config) return undefined

  return (runtimeProvider) => {
    if (typeof runtimeProvider !== "function") throw invalidConfig()
    return createConfiguredExecutor(config, runtimeProvider, dependencies)
  }
}

function createConfiguredExecutor(
  config: ProductionRemediationConfig,
  runtimeProvider: RuntimeProvider,
  dependencies: ProductionRemediationDependencies,
): IncidentRemediationExecutor {
  const createProducer = dependencies.createProducer
    ?? ((producerConfig) => new CodexRemediationPatchProducer(producerConfig))
  const createExecutor = dependencies.createExecutor
    ?? ((executorConfig) => new LocalWorktreeRemediationExecutor(executorConfig))

  return {
    async execute(input: IncidentRemediationExecutorInput): Promise<unknown> {
      const runtime = await runtimeProvider()
      const producer = createProducer({ runtime, turnTimeoutMs: config.turnTimeoutMs })
      const executor = createExecutor({
        repositoryRoot: config.repositoryRoot,
        trustedBaseRef: config.trustedBaseRef,
        pullRequestBaseBranch: config.pullRequestBaseBranch,
        scratchParent: config.scratchParent,
        regressionCommand: [...config.regressionCommand],
        validationCommands: config.validationCommands.map((command) => [...command]),
        commandTimeoutMs: config.commandTimeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        producer,
      })
      return executor.execute(input)
    },
  }
}

function parseConfig(environment: Environment): ProductionRemediationConfig | null {
  const enabled = environment.PODO_REMEDIATION_ENABLED
  if (enabled === undefined || enabled === "false") return null
  if (enabled !== "true") throw invalidConfig()

  const repositoryRoot = required(environment, "PODO_REMEDIATION_REPOSITORY_ROOT")
  const trustedBaseRef = required(environment, "PODO_REMEDIATION_BASE_REF")
  const pullRequestBaseBranch = required(environment, "PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH")
  const scratchParent = required(environment, "PODO_REMEDIATION_SCRATCH_PARENT")
  const regressionCommand = command(environment.PODO_REMEDIATION_REGRESSION_COMMAND)
  const validationCommands = commandList(environment.PODO_REMEDIATION_VALIDATION_COMMANDS)
  const commandTimeoutMs = boundedInteger(environment.PODO_REMEDIATION_COMMAND_TIMEOUT_MS, 100, 300_000)
  const turnTimeoutMs = boundedInteger(environment.PODO_REMEDIATION_TURN_TIMEOUT_MS, 10, 300_000)
  const maxOutputBytes = boundedInteger(environment.PODO_REMEDIATION_MAX_OUTPUT_BYTES, 1_024, 512 * 1_024)

  if (!safeAbsolutePath(repositoryRoot)
    || !safeAbsolutePath(scratchParent)
    || pathsOverlap(repositoryRoot, scratchParent)
    || !safeRef(trustedBaseRef)
    || !safeBranch(pullRequestBaseBranch)) throw invalidConfig()

  return {
    repositoryRoot,
    trustedBaseRef,
    pullRequestBaseBranch,
    scratchParent,
    regressionCommand,
    validationCommands,
    commandTimeoutMs,
    turnTimeoutMs,
    maxOutputBytes,
  }
}

function required(environment: Environment, key: string): string {
  const value = environment[key]
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.includes("\0")) throw invalidConfig()
  return value
}

function command(value: string | undefined): string[] {
  const parsed = parseJson(value)
  if (!isCommand(parsed)) throw invalidConfig()
  return [...parsed]
}

function commandList(value: string | undefined): string[][] {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > 20
    || !parsed.every(isCommand)) throw invalidConfig()
  return parsed.map((entry) => [...entry])
}

function parseJson(value: string | undefined): unknown {
  if (typeof value !== "string" || value.length === 0) throw invalidConfig()
  try {
    return JSON.parse(value)
  } catch {
    throw invalidConfig()
  }
}

function isCommand(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return false
  if (!value.every((argument) => typeof argument === "string" && argument.length > 0 && argument.length <= 8_192 && !argument.includes("\0"))) return false
  const executable = value[0]!
  return isAbsolute(executable) || /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(executable)
}

function boundedInteger(value: string | undefined, minimum: number, maximum: number): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) throw invalidConfig()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw invalidConfig()
  return parsed
}

function safeAbsolutePath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value
}

function pathsOverlap(left: string, right: string): boolean {
  const leftToRight = relative(left, right)
  const rightToLeft = relative(right, left)
  return leftToRight === "" || !leftToRight.startsWith("..") || !rightToLeft.startsWith("..")
}

function safeRef(value: string): boolean {
  return value.length <= 255
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".")
}

function safeBranch(value: string): boolean {
  return safeRef(value) && !value.startsWith("refs/")
}

function invalidConfig(): ProductionRemediationConfigError {
  return new ProductionRemediationConfigError()
}
