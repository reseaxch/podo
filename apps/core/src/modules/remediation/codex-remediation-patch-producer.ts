import { createHash } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

import type {
  CodexRuntime,
  CodexRuntimeEvent,
  StartCodexThreadInput,
} from "@podo/codex-app-server-client"

import type { RemediationPatchProducer, RemediationPatchProducerInput } from "./local-worktree-remediation-executor"

export interface CodexRemediationPatchProducerConfig {
  runtime: CodexRuntime
  turnTimeoutMs: number
}

export class CodexRemediationPatchProducerError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "CodexRemediationPatchProducerError"
  }
}

interface CompletedRegression {
  threadId: string
  contextFingerprint: string
}

const developerInstructions = [
  "You are the patch worker for a human-approved Podo remediation attempt.",
  "Operate only inside the supplied isolated detached worktree.",
  "Network access is forbidden. Do not request broader filesystem or network permissions.",
  "Never read or write outside the worktree. Never stage, commit, push, merge, or create branches.",
  "Do not modify production, the source checkout, or the default branch.",
  "Follow the phase prompt exactly and stop when that phase is complete.",
].join(" ")

export class CodexRemediationPatchProducer implements RemediationPatchProducer {
  private readonly runtime: CodexRuntime
  private readonly turnTimeoutMs: number
  private readonly completedRegressions = new Map<string, CompletedRegression>()

  constructor(config: CodexRemediationPatchProducerConfig) {
    if (!isRuntime(config?.runtime)
      || !Number.isSafeInteger(config.turnTimeoutMs)
      || config.turnTimeoutMs < 10
      || config.turnTimeoutMs > 300_000) {
      throw failure("invalid_codex_remediation_producer_config")
    }
    this.runtime = config.runtime
    this.turnTimeoutMs = config.turnTimeoutMs
  }

  async writeRegression(input: RemediationPatchProducerInput): Promise<void> {
    const validated = validateInput(input)
    if (this.completedRegressions.has(validated.worktreePath)) {
      throw failure("codex_remediation_regression_already_written")
    }

    const threadInput = boundedThreadInput(validated.worktreePath)
    let threadId: string
    try {
      const thread = await this.runtime.startThread(threadInput, { timeoutMs: this.turnTimeoutMs })
      threadId = requireOpaqueId(thread.threadId, "codex_remediation_thread_start_failed")
      await this.runTurn(threadId, regressionPrompt(validated))
    } catch (error) {
      this.completedRegressions.delete(validated.worktreePath)
      throw sanitize(error, "codex_remediation_regression_turn_failed")
    }

    this.completedRegressions.set(validated.worktreePath, {
      threadId,
      contextFingerprint: validated.contextFingerprint,
    })
  }

  async applyFix(input: RemediationPatchProducerInput): Promise<void> {
    const validated = validateInput(input)
    const completedRegression = this.completedRegressions.get(validated.worktreePath)
    if (!completedRegression) throw failure("codex_remediation_regression_required")
    if (completedRegression.contextFingerprint !== validated.contextFingerprint) {
      throw failure("codex_remediation_context_mismatch")
    }

    try {
      const resumed = await this.runtime.resumeThread(
        completedRegression.threadId,
        boundedThreadInput(validated.worktreePath),
        { timeoutMs: this.turnTimeoutMs },
      )
      if (resumed.threadId !== completedRegression.threadId) {
        throw failure("codex_remediation_thread_mismatch")
      }
      await this.runTurn(completedRegression.threadId, fixPrompt(validated))
    } catch (error) {
      throw sanitize(error, "codex_remediation_fix_turn_failed")
    } finally {
      this.completedRegressions.delete(validated.worktreePath)
    }
  }

  async dispose(input: RemediationPatchProducerInput): Promise<void> {
    const identity = validateDisposalInput(input)
    const completedRegression = this.completedRegressions.get(identity.worktreePath)
    if (completedRegression?.contextFingerprint === identity.contextFingerprint) {
      this.completedRegressions.delete(identity.worktreePath)
    }
  }

  private async runTurn(threadId: string, prompt: string): Promise<void> {
    let turnId: string | undefined
    let unsubscribe = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let resolveDone!: () => void
    let rejectDone!: (error: Error) => void
    const buffered: CodexRuntimeEvent[] = []
    let eventQueue = Promise.resolve()
    const done = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveDone = resolvePromise
      rejectDone = rejectPromise
    })

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolveDone()
    }
    const fail = (error: CodexRemediationPatchProducerError, interrupt: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      if (interrupt && turnId) {
        void this.runtime.interruptTurn(threadId, turnId, { timeoutMs: this.turnTimeoutMs }).catch(() => undefined)
      }
      rejectDone(error)
    }
    const processEvent = async (event: CodexRuntimeEvent) => {
      if (settled) return
      if (event.kind === "approval.requested") {
        const code = event.approvalKind === "command" || event.approvalKind === "file_change"
          ? "codex_remediation_unprovable_approval"
          : "codex_remediation_forbidden_approval"
        try {
          await this.runtime.resolveApproval(event.requestId, "deny")
        } catch {
          fail(failure("codex_remediation_approval_denial_failed"), true)
          return
        }
        fail(failure(code), true)
        return
      }
      if (event.kind === "runtime.error") {
        fail(failure("codex_remediation_runtime_failed"), false)
        return
      }
      if (event.kind !== "turn.completed") return
      if (event.status === "completed") succeed()
      else fail(failure(`codex_remediation_turn_${event.status}`), false)
    }
    const enqueue = (event: CodexRuntimeEvent) => {
      eventQueue = eventQueue
        .then(() => processEvent(event))
        .catch(() => fail(failure("codex_remediation_event_failed"), true))
    }
    const receivesEvent = (event: CodexRuntimeEvent): boolean => {
      if (event.kind === "runtime.error" && !event.threadId) return true
      if (!("threadId" in event) || event.threadId !== threadId) return false
      if (!("turnId" in event) || !event.turnId || !turnId) return true
      return event.turnId === turnId
    }

    unsubscribe = this.runtime.onEvent((event) => {
      if (!receivesEvent(event)) return
      if (!turnId) buffered.push(event)
      else enqueue(event)
    })

    try {
      const turn = await this.runtime.startTurn(threadId, prompt, { timeoutMs: this.turnTimeoutMs })
      turnId = requireOpaqueId(turn.turnId, "codex_remediation_turn_start_failed")
    } catch (error) {
      cleanup()
      throw sanitize(error, "codex_remediation_turn_start_failed")
    }

    for (const event of buffered.splice(0)) {
      if (receivesEvent(event)) enqueue(event)
    }
    timer = setTimeout(() => fail(failure("codex_remediation_turn_timeout"), true), this.turnTimeoutMs)
    return done
  }
}

interface ValidatedInput extends RemediationPatchProducerInput {
  worktreePath: string
  contextFingerprint: string
}

function validateInput(input: RemediationPatchProducerInput): ValidatedInput {
  try {
    const identity = validateDisposalInput(input)
    if (!statSync(identity.worktreePath).isDirectory()) throw new Error()
    const worktreePath = realpathSync(input.worktreePath)
    if (worktreePath !== input.worktreePath) throw new Error()
    return {
      worktreePath,
      remediation: structuredClone(input.remediation),
      contextFingerprint: identity.contextFingerprint,
    }
  } catch {
    throw failure("invalid_codex_remediation_producer_input")
  }
}

function validateDisposalInput(input: RemediationPatchProducerInput): {
  worktreePath: string
  contextFingerprint: string
} {
  try {
    if (!input || typeof input !== "object") throw new Error()
    if (typeof input.worktreePath !== "string"
      || !isAbsolute(input.worktreePath)
      || resolve(input.worktreePath) !== input.worktreePath) throw new Error()
    if (!input.remediation || typeof input.remediation !== "object") throw new Error()
    if (input.remediation.target !== "isolated_checkout") throw new Error()
    const serialized = JSON.stringify(input.remediation)
    if (!serialized || serialized.length > 128 * 1024) throw new Error()
    return {
      worktreePath: input.worktreePath,
      contextFingerprint: createHash("sha256").update(serialized).digest("hex"),
    }
  } catch {
    throw failure("invalid_codex_remediation_producer_input")
  }
}

function boundedThreadInput(cwd: string): StartCodexThreadInput {
  return { cwd, sandbox: "workspace-write", developerInstructions }
}

function regressionPrompt(input: ValidatedInput): string {
  return [
    "PHASE 1 OF 2: WRITE THE REGRESSION",
    "Inspect only the isolated worktree and add one focused regression test that proves the diagnosed defect.",
    "Do not modify production implementation in this phase. Do not weaken or delete existing tests.",
    "Do not run network commands and do not request any approval or permission expansion.",
    "Stop after the regression test has been written.",
    `Trusted remediation context: ${trustedContext(input)}`,
  ].join("\n")
}

function fixPrompt(input: ValidatedInput): string {
  return [
    "PHASE 2 OF 2: APPLY THE FIX",
    "Continue the same remediation thread and apply the smallest production-code fix for the validated diagnosis.",
    "Do not modify the regression test written in phase 1. Do not weaken or delete any test.",
    "Do not stage, commit, push, merge, create branches, use the network, or request expanded permissions.",
    "Stop after the minimal fix has been written; Podo runs regression and validation commands independently.",
    `Trusted remediation context: ${trustedContext(input)}`,
  ].join("\n")
}

function trustedContext(input: ValidatedInput): string {
  const { incident, target, policy } = input.remediation
  return JSON.stringify({
    incidentId: incident.id,
    affectedService: incident.affectedService,
    deploymentId: incident.deploymentId,
    evidenceIds: incident.evidenceIds,
    diagnosis: incident.diagnosis,
    target,
    allowedTools: policy.allowedTools,
  })
}

function isRuntime(runtime: unknown): runtime is CodexRuntime {
  if (!runtime || typeof runtime !== "object") return false
  const candidate = runtime as Partial<Record<keyof CodexRuntime, unknown>>
  return ["startThread", "resumeThread", "startTurn", "interruptTurn", "resolveApproval", "onEvent"]
    .every((method) => typeof candidate[method as keyof CodexRuntime] === "function")
}

function requireOpaqueId(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw failure(code)
  return value
}

function sanitize(error: unknown, fallbackCode: string): CodexRemediationPatchProducerError {
  return error instanceof CodexRemediationPatchProducerError ? error : failure(fallbackCode)
}

function failure(code: string): CodexRemediationPatchProducerError {
  return new CodexRemediationPatchProducerError(code)
}
