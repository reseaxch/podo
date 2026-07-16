import { expect, test } from "bun:test"
import { loadProductionAgentChat } from "./production-agent-chat"

test("production agent chat is disabled by default", async () => {
  await expect(loadProductionAgentChat({})).resolves.toBeUndefined()
})

test("production agent chat resolves one operator-configured directory", async () => {
  const resolved: string[] = []
  await expect(loadProductionAgentChat({ PODO_AGENT_CHAT_ENABLED: "true", PODO_AGENT_CHAT_CWD: "/configured/repository" }, {
    async resolveDirectory(path) { resolved.push(path); return "/canonical/repository" },
  })).resolves.toEqual({ cwd: "/canonical/repository" })
  expect(resolved).toEqual(["/configured/repository"])
})

test("production agent chat rejects ambiguous or unsafe configuration before startup", async () => {
  const invalid = [
    { PODO_AGENT_CHAT_ENABLED: "yes", PODO_AGENT_CHAT_CWD: "/repository" },
    { PODO_AGENT_CHAT_ENABLED: "true" },
    { PODO_AGENT_CHAT_ENABLED: "true", PODO_AGENT_CHAT_CWD: "relative/repository" },
    { PODO_AGENT_CHAT_ENABLED: "true", PODO_AGENT_CHAT_CWD: "/repository/../other" },
  ]
  for (const environment of invalid) {
    await expect(loadProductionAgentChat(environment)).rejects.toThrow("invalid_production_agent_chat_config")
  }
})
