import { createHash, randomUUID } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import { rm } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

import type {
  IncidentRemediationExecutor,
  IncidentRemediationExecutorInput,
  IncidentRemediationExecutorResult,
} from "./incident-remediation"

export interface RemediationPatchProducerInput {
  worktreePath: string
  remediation: IncidentRemediationExecutorInput
}

export interface RemediationPatchProducer {
  writeRegression(input: RemediationPatchProducerInput): Promise<void>
  applyFix(input: RemediationPatchProducerInput): Promise<void>
}

export interface LocalWorktreeRemediationExecutorConfig {
  repositoryRoot: string
  trustedBaseRef: string
  scratchParent: string
  regressionCommand: string[]
  validationCommands: string[][]
  commandTimeoutMs: number
  maxOutputBytes: number
  producer: RemediationPatchProducer
}

export class LocalWorktreeRemediationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "LocalWorktreeRemediationError"
  }
}

interface ValidatedConfig extends LocalWorktreeRemediationExecutorConfig {
  repositoryRoot: string
  scratchParent: string
}

interface CommandResult {
  exitCode: number
  stdout: Uint8Array
}

interface CapturedStream {
  bytes: Uint8Array
  exceeded: boolean
}

export class LocalWorktreeRemediationExecutor implements IncidentRemediationExecutor {
  private readonly config: ValidatedConfig

  constructor(config: LocalWorktreeRemediationExecutorConfig) {
    this.config = validateConfig(config)
  }

  async execute(input: IncidentRemediationExecutorInput): Promise<IncidentRemediationExecutorResult> {
    if (input.target !== "isolated_checkout") throw failure("unsafe_remediation_target")
    if (!input.policy.allowedTools.includes("apply_patch") || !input.policy.allowedTools.includes("run_test")) {
      throw failure("remediation_policy_inconsistent")
    }
    const repository = await this.verifyRepository()
    const worktreePath = resolve(this.config.scratchParent, `podo-remediation-${randomUUID()}`)
    assertOwnedPath(this.config.scratchParent, worktreePath)
    let registered = false

    try {
      const added = await this.git(["worktree", "add", "--detach", worktreePath, repository.baseCommit], this.config.repositoryRoot)
      if (added.exitCode !== 0) throw failure("worktree_create_failed")
      registered = true
      await this.requireCleanWorktree(worktreePath, repository.baseCommit)

      try {
        await this.config.producer.writeRegression({ worktreePath, remediation: structuredClone(input) })
      } catch {
        throw failure("regression_producer_failed")
      }
      if (!(await this.hasWorktreeChanges(worktreePath))) throw failure("regression_producer_no_changes")
      const regressionPatch = await this.collectPatch(worktreePath)
      const regressionFileHashes = await this.hashFiles(worktreePath, regressionPatch.changedFiles)

      const prePatch = await this.command(this.config.regressionCommand, worktreePath)
      if (prePatch.exitCode === 0) throw failure("regression_did_not_fail_before_patch")
      const afterRegressionRun = await this.collectPatch(worktreePath)
      if (afterRegressionRun.unifiedDiff !== regressionPatch.unifiedDiff) throw failure("regression_command_mutated_worktree")

      try {
        await this.config.producer.applyFix({ worktreePath, remediation: structuredClone(input) })
      } catch {
        throw failure("fix_producer_failed")
      }
      const hashesAfterFix = await this.hashFiles(worktreePath, regressionPatch.changedFiles)
      if (hashesAfterFix.some((hash, index) => hash !== regressionFileHashes[index])) {
        throw failure("fix_mutated_regression")
      }

      const postPatch = await this.command(this.config.regressionCommand, worktreePath)
      if (postPatch.exitCode !== 0) throw failure("regression_failed_after_patch")

      for (const command of this.config.validationCommands) {
        const validation = await this.command(command, worktreePath)
        if (validation.exitCode !== 0) throw failure("remediation_validation_failed")
      }

      const patch = await this.collectPatch(worktreePath)
      return buildResult(
        input,
        this.config.trustedBaseRef,
        repository.baseCommit,
        patch,
        this.config.validationCommands.map((_, index) => `validation-${index + 1}`),
      )
    } finally {
      await this.cleanup(worktreePath, registered)
    }
  }

  private async verifyRepository(): Promise<{ baseCommit: string }> {
    const root = await this.git(["rev-parse", "--show-toplevel"], this.config.repositoryRoot)
    if (root.exitCode !== 0) throw failure("repository_unavailable")
    const reportedRoot = decode(root.stdout).trim()
    let canonicalReportedRoot: string
    try {
      canonicalReportedRoot = realpathSync(reportedRoot)
    } catch {
      throw failure("repository_unavailable")
    }
    if (canonicalReportedRoot !== this.config.repositoryRoot) throw failure("repository_root_mismatch")

    const filters = await this.git(["config", "--local", "--get-regexp", "^filter\\..*\\.(clean|smudge|process)$"], this.config.repositoryRoot)
    if ((filters.exitCode !== 0 && filters.exitCode !== 1) || filters.stdout.length > 0) {
      throw failure("repository_external_filter_forbidden")
    }

    const base = await this.git(["rev-parse", "--verify", `${this.config.trustedBaseRef}^{commit}`], this.config.repositoryRoot)
    if (base.exitCode !== 0) throw failure("trusted_base_ref_unavailable")
    const baseCommit = decode(base.stdout).trim()
    if (!/^[a-f0-9]{40,64}$/.test(baseCommit)) throw failure("trusted_base_ref_unavailable")

    return { baseCommit }
  }

  private async requireCleanWorktree(worktreePath: string, expectedCommit: string): Promise<void> {
    const head = await this.git(["rev-parse", "--verify", "HEAD"], worktreePath)
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktreePath)
    const actualCommit = head.exitCode === 0 ? decode(head.stdout).trim() : ""
    if (actualCommit !== expectedCommit || status.exitCode !== 0 || status.stdout.length !== 0) {
      throw failure("worktree_initialization_failed")
    }
  }

  private async hasWorktreeChanges(worktreePath: string): Promise<boolean> {
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktreePath)
    if (status.exitCode !== 0) throw failure("worktree_status_failed")
    return status.stdout.length > 0
  }

  private async collectPatch(worktreePath: string): Promise<{ unifiedDiff: string; changedFiles: string[] }> {
    const staged = await this.git(["diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--"], worktreePath)
    if (staged.exitCode !== 0) throw failure("producer_staged_changes")

    const untracked = await this.git(["ls-files", "--others", "--exclude-standard", "-z"], worktreePath)
    if (untracked.exitCode !== 0) throw failure("worktree_status_failed")
    const untrackedPaths = splitNull(untracked.stdout).sort(compareCodeUnits)
    if (untrackedPaths.some((path) => !isSafeRelativePath(path))) throw failure("unsafe_changed_path")

    const tracked = await this.git(["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--"], worktreePath)
    if (tracked.exitCode !== 0) throw failure("diff_collect_failed")
    const trackedPaths = splitNull(tracked.stdout).sort(compareCodeUnits)
    const untrackedSet = new Set(untrackedPaths)
    const changedFiles = [...new Set([...trackedPaths, ...untrackedPaths])].sort(compareCodeUnits)
    if (changedFiles.length === 0 || changedFiles.length > 100 || changedFiles.some((path) => !isSafeRelativePath(path))) {
      throw failure("unsafe_changed_path")
    }

    const fragments: Uint8Array[] = []
    let totalBytes = 0
    for (const path of changedFiles) {
      const diff = untrackedSet.has(path)
        ? await this.git(["diff", "--no-index", "--binary", "--no-ext-diff", "--no-textconv", "--", "/dev/null", path], worktreePath)
        : await this.git(["diff", "--binary", "--no-ext-diff", "--no-textconv", "--", path], worktreePath)
      const expectedExit = untrackedSet.has(path) ? 1 : 0
      if (diff.exitCode !== expectedExit || diff.stdout.length === 0) throw failure("diff_collect_failed")
      totalBytes += diff.stdout.length
      if (totalBytes > this.config.maxOutputBytes) throw failure("remediation_command_output_exceeded")
      fragments.push(diff.stdout)
    }
    const unifiedDiff = decode(concat(fragments, totalBytes))
    if (!unifiedDiff.startsWith("diff --git ") || unifiedDiff.length === 0) throw failure("diff_collect_failed")
    return { unifiedDiff, changedFiles }
  }

  private async hashFiles(worktreePath: string, paths: string[]): Promise<string[]> {
    const hashes: string[] = []
    for (const path of paths) {
      const result = await this.git(["hash-object", "--", path], worktreePath)
      const hash = decode(result.stdout).trim()
      if (result.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(hash)) throw failure("regression_file_unavailable")
      hashes.push(hash)
    }
    return hashes
  }

  private async cleanup(worktreePath: string, registered: boolean): Promise<void> {
    assertOwnedPath(this.config.scratchParent, worktreePath)
    let failed = false
    if (registered) {
      try {
        const removed = await this.git(["worktree", "remove", "--force", worktreePath], this.config.repositoryRoot, true)
        if (removed.exitCode !== 0) failed = true
      } catch {
        failed = true
      }
    }
    try {
      await rm(worktreePath, { recursive: true, force: true })
    } catch {
      failed = true
    }
    try {
      const pruned = await this.git(["worktree", "prune"], this.config.repositoryRoot, true)
      if (pruned.exitCode !== 0) failed = true
    } catch {
      failed = true
    }
    if (failed) throw failure("worktree_cleanup_failed")
  }

  private git(argv: string[], cwd: string, cleanup = false): Promise<CommandResult> {
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key === "GIT_DIR"
        || key === "GIT_WORK_TREE"
        || key === "GIT_INDEX_FILE"
        || key === "GIT_OBJECT_DIRECTORY"
        || key === "GIT_ALTERNATE_OBJECT_DIRECTORIES"
        || key === "GIT_EXEC_PATH"
        || key.startsWith("GIT_CONFIG_")) delete env[key]
    }
    env.GIT_CONFIG_GLOBAL = "/dev/null"
    env.GIT_CONFIG_NOSYSTEM = "1"
    return this.run(
      ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...argv],
      cwd,
      cleanup ? "worktree_cleanup_failed" : "git_command_failed",
      env,
    )
  }

  private command(argv: string[], cwd: string): Promise<CommandResult> {
    return this.run(argv, cwd, "remediation_command_failed")
  }

  private async run(argv: string[], cwd: string, failureCode: string, env?: Record<string, string | undefined>): Promise<CommandResult> {
    let process: Bun.Subprocess<"ignore", "pipe", "pipe">
    try {
      process = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...(env ? { env } : {}) })
    } catch {
      throw failure(failureCode)
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(9) } catch {}
    }, this.config.commandTimeoutMs)
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        capture(process.stdout, this.config.maxOutputBytes),
        capture(process.stderr, this.config.maxOutputBytes),
      ])
      if (timedOut) throw failure("remediation_command_timeout")
      if (stdout.exceeded || stderr.exceeded) throw failure("remediation_command_output_exceeded")
      return { exitCode, stdout: stdout.bytes }
    } catch (error) {
      if (error instanceof LocalWorktreeRemediationError) throw error
      throw failure(failureCode)
    } finally {
      clearTimeout(timer)
    }
  }
}

function validateConfig(config: LocalWorktreeRemediationExecutorConfig): ValidatedConfig {
  try {
    if (!config || typeof config !== "object") throw new Error()
    const repositoryRoot = canonicalDirectory(config.repositoryRoot)
    const scratchParent = canonicalDirectory(config.scratchParent)
    if (!repositoryRoot || !scratchParent || pathsOverlap(repositoryRoot, scratchParent)) throw new Error()
    if (!isSafeRef(config.trustedBaseRef)) throw new Error()
    if (!isCommand(config.regressionCommand)) throw new Error()
    if (!Array.isArray(config.validationCommands)
      || config.validationCommands.length === 0
      || config.validationCommands.length > 20
      || !config.validationCommands.every(isCommand)) throw new Error()
    if (!Number.isSafeInteger(config.commandTimeoutMs)
      || config.commandTimeoutMs < 100
      || config.commandTimeoutMs > 300_000) throw new Error()
    if (!Number.isSafeInteger(config.maxOutputBytes)
      || config.maxOutputBytes < 1_024
      || config.maxOutputBytes > 512 * 1024) throw new Error()
    if (!config.producer
      || typeof config.producer.writeRegression !== "function"
      || typeof config.producer.applyFix !== "function") throw new Error()
    return {
      ...config,
      repositoryRoot,
      scratchParent,
      regressionCommand: [...config.regressionCommand],
      validationCommands: config.validationCommands.map((command) => [...command]),
    }
  } catch {
    throw failure("invalid_remediation_executor_config")
  }
}

function canonicalDirectory(path: unknown): string | null {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) return null
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : null
  } catch {
    return null
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const leftToRight = relative(left, right)
  const rightToLeft = relative(right, left)
  return leftToRight === "" || !leftToRight.startsWith("..") || !rightToLeft.startsWith("..")
}

function isSafeRef(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".")
}

function isCommand(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return false
  if (!value.every((argument) => typeof argument === "string" && argument.length > 0 && argument.length <= 8_192 && !argument.includes("\0"))) return false
  const executable = value[0]!
  return isAbsolute(executable) || /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(executable)
}

function assertOwnedPath(parent: string, path: string): void {
  const child = relative(parent, path)
  if (child.length === 0 || child.startsWith("..") || child.includes("/") || !/^podo-remediation-[a-f0-9-]+$/.test(child)) {
    throw failure("unsafe_worktree_path")
  }
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 512 || path.startsWith("/") || path.includes("\\")) return false
  return path.split("/").every((segment) => /^[A-Za-z0-9._@+-]+$/.test(segment) && segment !== "." && segment !== "..")
}

function buildResult(
  input: IncidentRemediationExecutorInput,
  baseRef: string,
  baseCommit: string,
  patch: { unifiedDiff: string; changedFiles: string[] },
  validationChecks: string[],
): IncidentRemediationExecutorResult {
  const fingerprint = createHash("sha256")
    .update(baseCommit)
    .update("\0")
    .update(input.incident.id)
    .update("\0")
    .update(patch.unifiedDiff)
    .digest("hex")
  const service = slug(input.incident.affectedService)
  const action = boundedLine(input.incident.diagnosis.recommendedAction, 180) || "apply verified remediation"
  const summary = boundedLine(`${action} for ${input.incident.affectedService}`, 500)
  return {
    patch: { summary, changedFiles: patch.changedFiles, unifiedDiff: patch.unifiedDiff },
    regression: { test: "incident regression", prePatch: "failed", postPatch: "passed" },
    validation: {
      status: "passed",
      checks: validationChecks,
    },
    pullRequestPreview: {
      title: boundedLine(`fix(${service}): ${action}`, 300),
      body: buildPreviewBody(input, patch.changedFiles, fingerprint),
      baseBranch: baseRef,
      headBranch: `podo/remediation-${fingerprint.slice(0, 16)}`,
    },
  }
}

function buildPreviewBody(input: IncidentRemediationExecutorInput, changedFiles: string[], fingerprint: string): string {
  const visibleFiles = changedFiles.slice(0, 20)
  const omitted = changedFiles.length - visibleFiles.length
  return [
    `Remediates the validated ${input.incident.affectedService} incident.`,
    "",
    `Root cause: ${boundedLine(input.incident.diagnosis.probableRootCause, 1_000)}`,
    `Action: ${boundedLine(input.incident.diagnosis.recommendedAction, 1_000)}`,
    "",
    "Verification: regression failed before the fix, passed after it, and all configured validation commands passed.",
    "",
    "Changed files:",
    ...visibleFiles.map((path) => `- ${path}`),
    ...(omitted > 0 ? [`- …and ${omitted} more files in the verified artifact`] : []),
    "",
    `Preview fingerprint: ${fingerprint.slice(0, 24)}`,
  ].join("\n")
}

function boundedLine(value: string, maxLength: number): string {
  const line = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
  return line.slice(0, maxLength).trim()
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized.slice(0, 80) || "service"
}

async function capture(stream: ReadableStream<Uint8Array>, limit: number): Promise<CapturedStream> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let captured = 0
  let observed = 0
  let exceeded = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      observed += value.byteLength
      if (captured < limit) {
        const remaining = limit - captured
        const chunk = value.byteLength <= remaining ? value : value.subarray(0, remaining)
        chunks.push(chunk)
        captured += chunk.byteLength
      }
      if (observed > limit) exceeded = true
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(captured)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, exceeded }
}

function splitNull(bytes: Uint8Array): string[] {
  return decode(bytes).split("\0").filter((entry) => entry.length > 0)
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw failure("command_output_invalid")
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function failure(code: string): LocalWorktreeRemediationError {
  return new LocalWorktreeRemediationError(code)
}
