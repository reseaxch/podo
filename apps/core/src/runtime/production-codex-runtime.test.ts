import { expect, test } from "bun:test"

import type {
  CodexRuntime,
  CodexRuntimeEvent,
  StartCodexThreadInput,
} from "@podo/codex-app-server-client"

import {
  DEFAULT_PODO_CODEX_MODEL,
  createProductionCodexRuntimeFactory,
} from "./production-codex-runtime"

class RecordingRuntime implements CodexRuntime {
  readonly starts: StartCodexThreadInput[] = []
  readonly resumes: Array<{ threadId: string; input: StartCodexThreadInput }> = []

  async startThread(input: StartCodexThreadInput) {
    this.starts.push(input)
    return { threadId: "thread-1" }
  }

  async resumeThread(threadId: string, input: StartCodexThreadInput) {
    this.resumes.push({ threadId, input })
    return { threadId }
  }

  async startTurn() { return { turnId: "turn-1" } }
  async steerTurn() { return { turnId: "turn-1" } }
  async interruptTurn() {}
  async resolveApproval() {}
  onEvent(_listener: (event: CodexRuntimeEvent) => void) { return () => {} }
  async close() {}
}

test("production runtime selects GPT-5.6 for every Core-owned thread by default", async () => {
  const base = new RecordingRuntime()
  const createRuntime = createProductionCodexRuntimeFactory({}, {
    async connect() { return base },
  })
  const runtime = await createRuntime()

  await runtime.startThread({ cwd: "/repo", sandbox: "read-only" })
  await runtime.resumeThread("thread-1", { cwd: "/repo", sandbox: "workspace-write" })

  expect(DEFAULT_PODO_CODEX_MODEL).toBe("gpt-5.6-sol")
  expect(base.starts).toEqual([{
    cwd: "/repo",
    sandbox: "read-only",
    model: "gpt-5.6-sol",
  }])
  expect(base.resumes).toEqual([{
    threadId: "thread-1",
    input: {
      cwd: "/repo",
      sandbox: "workspace-write",
      model: "gpt-5.6-sol",
    },
  }])
})

test("production runtime accepts only an explicit supported GPT-5.6 model", async () => {
  const base = new RecordingRuntime()
  const createRuntime = createProductionCodexRuntimeFactory({
    PODO_CODEX_MODEL: "gpt-5.6-terra",
  }, {
    async connect() { return base },
  })
  const runtime = await createRuntime()

  await runtime.startThread({
    cwd: "/repo",
    sandbox: "read-only",
    model: "caller-selected-model",
  })

  expect(base.starts[0]?.model).toBe("gpt-5.6-terra")
})

test("invalid model configuration fails closed without exposing its raw value", async () => {
  const privateValue = "gpt-5.6-sol\nprivate-token"
  let connected = false

  expect(() => createProductionCodexRuntimeFactory({
    PODO_CODEX_MODEL: privateValue,
  }, {
    async connect() {
      connected = true
      return new RecordingRuntime()
    },
  })).toThrow("invalid_production_codex_model_config")

  try {
    createProductionCodexRuntimeFactory({ PODO_CODEX_MODEL: privateValue })
  } catch (error) {
    expect(String(error)).not.toContain(privateValue)
  }
  expect(connected).toBe(false)
})
