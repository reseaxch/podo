import { realpath, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { AgentChatConfig } from "../agent-chat"

type Environment = Readonly<Record<string, string | undefined>>
export interface ProductionAgentChatDependencies { resolveDirectory?: (path: string) => Promise<string> }

export class ProductionAgentChatConfigError extends Error {
  readonly code = "invalid_production_agent_chat_config"
  constructor() {
    super("invalid_production_agent_chat_config")
    this.name = "ProductionAgentChatConfigError"
  }
}

export async function loadProductionAgentChat(
  environment: Environment,
  dependencies: ProductionAgentChatDependencies = {},
): Promise<AgentChatConfig | undefined> {
  const enabled = environment.PODO_AGENT_CHAT_ENABLED
  if (enabled === undefined || enabled === "false") return undefined
  if (enabled !== "true") throw invalidConfig()
  const configured = environment.PODO_AGENT_CHAT_CWD
  if (typeof configured !== "string"
    || configured.length === 0
    || configured.length > 4_096
    || configured !== configured.trim()
    || configured.includes("\0")
    || !isAbsolute(configured)
    || resolve(configured) !== configured) throw invalidConfig()
  try {
    const resolved = await (dependencies.resolveDirectory ?? resolveRealDirectory)(configured)
    if (!isAbsolute(resolved) || resolve(resolved) !== resolved) throw invalidConfig()
    return { cwd: resolved }
  } catch {
    throw invalidConfig()
  }
}

async function resolveRealDirectory(path: string): Promise<string> {
  const resolved = await realpath(path)
  if (!(await stat(resolved)).isDirectory()) throw invalidConfig()
  return resolved
}

function invalidConfig(): ProductionAgentChatConfigError { return new ProductionAgentChatConfigError() }
