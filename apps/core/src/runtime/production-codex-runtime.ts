import {
  AppServerRuntime,
  type CodexRuntime,
} from "@podo/codex-app-server-client"

type Environment = Readonly<Record<string, string | undefined>>

export const DEFAULT_PODO_CODEX_MODEL = "gpt-5.6-sol"

const supportedModels = new Set([
  DEFAULT_PODO_CODEX_MODEL,
  "gpt-5.6-terra",
])

export interface ProductionCodexRuntimeDependencies {
  connect?: () => Promise<CodexRuntime>
}

export class ProductionCodexModelConfigError extends Error {
  readonly code = "invalid_production_codex_model_config"

  constructor() {
    super("invalid_production_codex_model_config")
    this.name = "ProductionCodexModelConfigError"
  }
}

export function createProductionCodexRuntimeFactory(
  environment: Environment,
  dependencies: ProductionCodexRuntimeDependencies = {},
): () => Promise<CodexRuntime> {
  const model = parseModel(environment.PODO_CODEX_MODEL)
  const connect = dependencies.connect ?? (() => AppServerRuntime.connect())

  return async () => selectModel(await connect(), model)
}

function parseModel(configured: string | undefined): string {
  if (configured === undefined) return DEFAULT_PODO_CODEX_MODEL
  if (!supportedModels.has(configured)) throw new ProductionCodexModelConfigError()
  return configured
}

function selectModel(runtime: CodexRuntime, model: string): CodexRuntime {
  return {
    startThread(input, options) {
      return runtime.startThread({ ...input, model }, options)
    },
    resumeThread(threadId, input, options) {
      return runtime.resumeThread(threadId, { ...input, model }, options)
    },
    startTurn(threadId, prompt, options) {
      return runtime.startTurn(threadId, prompt, options)
    },
    steerTurn(threadId, turnId, prompt, options) {
      return runtime.steerTurn(threadId, turnId, prompt, options)
    },
    interruptTurn(threadId, turnId, options) {
      return runtime.interruptTurn(threadId, turnId, options)
    },
    resolveApproval(requestId, decision, answers) {
      return runtime.resolveApproval(requestId, decision, answers)
    },
    onEvent(listener) {
      return runtime.onEvent(listener)
    },
    close() {
      return runtime.close()
    },
  }
}
