import { describe, expect, test } from "bun:test"
import type { CodexRuntime } from "@podo/codex-app-server-client"
import { buildRemediatorPrompt } from "@podo/domain"
import type {
  IncidentRemediationExecutor,
  IncidentRemediationExecutorInput,
} from "../modules/remediation/incident-remediation"
import type {
  LocalWorktreeRemediationExecutorConfig,
  RemediationPatchProducer,
} from "../modules/remediation/local-worktree-remediation-executor"
import {
  ProductionRemediationConfigError,
  createProductionRemediationExecutor,
  createProductionRemediationExecutorFactory,
} from "./production-remediation"

const enabledEnvironment = {
  PODO_REMEDIATION_ENABLED: "true",
  PODO_REMEDIATION_REPOSITORY_ROOT: "/repo",
  PODO_REMEDIATION_BASE_REF: "refs/heads/main",
  PODO_REMEDIATION_SCRATCH_PARENT: "/scratch",
  PODO_REMEDIATION_REGRESSION_COMMAND: '["bun","test","demo/services/checkout-service"]',
  PODO_REMEDIATION_VALIDATION_COMMANDS: '[["bun","run","typecheck"],["bun","test"]]',
  PODO_REMEDIATION_COMMAND_TIMEOUT_MS: "120000",
  PODO_REMEDIATION_TURN_TIMEOUT_MS: "90000",
  PODO_REMEDIATION_MAX_OUTPUT_BYTES: "524288",
} as const

describe("production remediation composition", () => {
  test("stays disabled without an explicit opt-in", () => {
    let runtimeRequests = 0
    expect(createProductionRemediationExecutor({}, async () => {
      runtimeRequests += 1
      return runtime
    })).toBeUndefined()
    expect(createProductionRemediationExecutor({ PODO_REMEDIATION_ENABLED: "false" }, async () => runtime)).toBeUndefined()
    expect(createProductionRemediationExecutorFactory({})).toBeUndefined()
    expect(runtimeRequests).toBe(0)
  })

  test("fails closed for incomplete, shell-shaped, or out-of-range configuration", () => {
    for (const environment of [
      { PODO_REMEDIATION_ENABLED: "true" },
      { ...enabledEnvironment, PODO_REMEDIATION_ENABLED: "yes" },
      { ...enabledEnvironment, PODO_REMEDIATION_REPOSITORY_ROOT: "relative/repo" },
      { ...enabledEnvironment, PODO_REMEDIATION_REGRESSION_COMMAND: '"bun test"' },
      { ...enabledEnvironment, PODO_REMEDIATION_VALIDATION_COMMANDS: '[["bun","test"],[]]' },
      { ...enabledEnvironment, PODO_REMEDIATION_COMMAND_TIMEOUT_MS: "0" },
      { ...enabledEnvironment, PODO_REMEDIATION_TURN_TIMEOUT_MS: "300001" },
      { ...enabledEnvironment, PODO_REMEDIATION_MAX_OUTPUT_BYTES: "not-a-number" },
    ]) {
      expect(() => createProductionRemediationExecutor(environment, async () => runtime)).toThrow(ProductionRemediationConfigError)
    }
  })

  test("acquires the shared runtime lazily and builds the verified executor with argv commands", async () => {
    let runtimeRequests = 0
    let producerConfig: { runtime: CodexRuntime; turnTimeoutMs: number } | undefined
    let executorConfig: LocalWorktreeRemediationExecutorConfig | undefined
    const expected = { marker: "verified-result" }
    const fakeProducer: RemediationPatchProducer = {
      async writeRegression() {},
      async applyFix() {},
    }
    const fakeExecutor: IncidentRemediationExecutor = {
      async execute() { return expected },
    }

    const factory = createProductionRemediationExecutorFactory(enabledEnvironment, {
      createProducer(config) {
        producerConfig = config
        return fakeProducer
      },
      createExecutor(config) {
        executorConfig = config
        return fakeExecutor
      },
    })
    const executor = factory!(async () => {
      runtimeRequests += 1
      return runtime
    })

    expect(executor).toBeDefined()
    expect(runtimeRequests).toBe(0)
    await expect(executor!.execute(remediationInput)).resolves.toBe(expected)
    expect(runtimeRequests).toBe(1)
    expect(producerConfig).toEqual({ runtime, turnTimeoutMs: 90_000 })
    expect(executorConfig).toEqual({
      repositoryRoot: "/repo",
      trustedBaseRef: "refs/heads/main",
      scratchParent: "/scratch",
      regressionCommand: ["bun", "test", "demo/services/checkout-service"],
      validationCommands: [["bun", "run", "typecheck"], ["bun", "test"]],
      commandTimeoutMs: 120_000,
      maxOutputBytes: 524_288,
      producer: fakeProducer,
    })
  })
})

const runtime: CodexRuntime = {
  async startThread() { return { threadId: "thread" } },
  async resumeThread() { return { threadId: "thread" } },
  async startTurn() { return { turnId: "turn" } },
  async steerTurn() { return { turnId: "turn" } },
  async interruptTurn() {},
  async resolveApproval() {},
  onEvent() { return () => undefined },
  async close() {},
}

const remediationInput: IncidentRemediationExecutorInput = {
  incident: {
    id: "incident-1",
    affectedService: "checkout-service",
    deploymentId: "deploy-1042",
    evidenceIds: ["evidence-1"],
    diagnosis: {
      schemaVersion: "podo.diagnosis.v1",
      status: "validated",
      summary: "Cache grows without a bound.",
      affectedService: "checkout-service",
      probableRootCause: "The cache no longer evicts entries.",
      confidence: {
        value: 9900,
        scale: "basis_points",
      },
      evidenceIds: ["evidence-1"],
      recommendedAction: "Restore a bounded cache.",
      safeToAttemptFix: true,
    },
  },
  target: "isolated_checkout",
  policy: buildRemediatorPrompt({
    mode: "act_with_approval",
    approval: "approved",
    regression: "not_run",
    target: "isolated_checkout",
  }),
}
