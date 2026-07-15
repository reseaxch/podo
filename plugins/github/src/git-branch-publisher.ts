import { createHash, randomUUID } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import { rm } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

export interface GitCommandRunnerInput {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  stdin?: string
  timeoutMs: number
  maxOutputBytes: number
}

export interface GitCommandRunnerResult {
  exitCode: number
  stdout: string
}

export interface GitCommandRunner {
  run(input: GitCommandRunnerInput): Promise<GitCommandRunnerResult>
}

export interface GitCliBranchPublisherConfig {
  repositoryRoot: string
  scratchParent: string
  remoteName: string
  owner: string
  repository: string
  defaultBranch: string
  token: string
  commandTimeoutMs: number
  maxOutputBytes: number
  runner?: GitCommandRunner
}

export interface PublishVerifiedBranchInput {
  baseCommit: string
  unifiedDiff: string
  patchSha256: string
  changedFiles: string[]
  resultTreeOid: string
  headBranch: string
  commitMessage: string
  commitTimestamp: string
}

export interface PublishedVerifiedBranch {
  headCommit: string
  resultTreeOid: string
  status: "created" | "reused"
}

export type GitCliBranchPublisherErrorCode =
  | "invalid_publisher_config"
  | "invalid_publish_input"
  | "repository_unavailable"
  | "repository_root_mismatch"
  | "repository_filter_forbidden"
  | "remote_url_mismatch"
  | "remote_base_unavailable"
  | "remote_base_mismatch"
  | "worktree_create_failed"
  | "worktree_initialization_failed"
  | "patch_apply_failed"
  | "changed_files_mismatch"
  | "result_tree_mismatch"
  | "commit_create_failed"
  | "unsafe_head_branch"
  | "remote_head_conflict"
  | "head_publish_failed"
  | "remote_base_drifted"
  | "worktree_cleanup_failed"
  | "git_command_failed"
  | "git_command_timeout"
  | "git_command_output_exceeded"

export class GitCliBranchPublisherError extends Error {
  constructor(readonly code: GitCliBranchPublisherErrorCode) {
    super(code)
    this.name = "GitCliBranchPublisherError"
  }
}

interface ValidatedConfig extends Omit<GitCliBranchPublisherConfig, "runner"> {
  repositoryRoot: string
  scratchParent: string
  expectedRemoteUrl: string
  runner: GitCommandRunner
}

interface GitOptions {
  authenticated?: boolean
  stdin?: string
  acceptableExitCodes?: number[]
  allowNonZero?: boolean
  extraEnv?: Record<string, string>
  failureCode?: GitCliBranchPublisherErrorCode
}

export class GitCliBranchPublisher {
  private readonly config: ValidatedConfig

  constructor(config: GitCliBranchPublisherConfig) {
    this.config = validateConfig(config)
  }

  async publish(rawInput: PublishVerifiedBranchInput): Promise<PublishedVerifiedBranch> {
    const input = validateInput(rawInput, this.config.defaultBranch)
    await this.verifyRepositoryAndRemote(input.baseCommit)

    const worktreePath = resolve(this.config.scratchParent, `podo-github-publish-${randomUUID()}`)
    assertOwnedPath(this.config.scratchParent, worktreePath)
    let registered = false

    try {
      const added = await this.git(
        ["worktree", "add", "--detach", worktreePath, input.baseCommit],
        this.config.repositoryRoot,
        { failureCode: "worktree_create_failed" },
      )
      if (added.exitCode !== 0) throw failure("worktree_create_failed")
      registered = true
      await this.requireCleanWorktree(worktreePath, input.baseCommit)

      await this.applyVerifiedPatch(worktreePath, input)
      const tree = await this.git(["write-tree"], worktreePath)
      const resultTreeOid = tree.stdout.trim()
      if (tree.exitCode !== 0 || resultTreeOid !== input.resultTreeOid) throw failure("result_tree_mismatch")

      const committed = await this.git(
        ["commit-tree", resultTreeOid, "-p", input.baseCommit, "-F", "-"],
        worktreePath,
        {
          stdin: `${input.commitMessage}\n`,
          failureCode: "commit_create_failed",
          extraEnv: {
            GIT_AUTHOR_NAME: "Podo",
            GIT_AUTHOR_EMAIL: "podo@users.noreply.github.com",
            GIT_AUTHOR_DATE: input.commitTimestamp,
            GIT_COMMITTER_NAME: "Podo",
            GIT_COMMITTER_EMAIL: "podo@users.noreply.github.com",
            GIT_COMMITTER_DATE: input.commitTimestamp,
          },
        },
      )
      const headCommit = committed.stdout.trim()
      if (committed.exitCode !== 0 || !isObjectId(headCommit) || headCommit.length !== input.baseCommit.length) {
        throw failure("commit_create_failed")
      }

      const existing = await this.readRemoteRef(input.headBranch)
      let status: PublishedVerifiedBranch["status"]
      if (existing === null) {
        const pushed = await this.git(
          [
            "push",
            "--porcelain",
            `--force-with-lease=refs/heads/${input.headBranch}:`,
            this.config.expectedRemoteUrl,
            `${headCommit}:refs/heads/${input.headBranch}`,
          ],
          this.config.repositoryRoot,
          { authenticated: true, allowNonZero: true, failureCode: "head_publish_failed" },
        )
        if (pushed.exitCode === 0) {
          status = "created"
        } else {
          const raced = await this.readRemoteRef(input.headBranch)
          if (raced !== headCommit) {
            throw failure(raced === null ? "head_publish_failed" : "remote_head_conflict")
          }
          status = "reused"
        }
      } else if (existing === headCommit) {
        status = "reused"
      } else {
        throw failure("remote_head_conflict")
      }

      const currentBase = await this.readRemoteRef(this.config.defaultBranch)
      if (currentBase !== input.baseCommit) throw failure("remote_base_drifted")
      return { headCommit, resultTreeOid, status }
    } finally {
      await this.cleanup(worktreePath, registered)
    }
  }

  private async verifyRepositoryAndRemote(baseCommit: string): Promise<void> {
    const root = await this.git(["rev-parse", "--show-toplevel"], this.config.repositoryRoot)
    if (root.exitCode !== 0) throw failure("repository_unavailable")
    let canonicalRoot: string
    try {
      canonicalRoot = realpathSync(root.stdout.trim())
    } catch {
      throw failure("repository_unavailable")
    }
    if (canonicalRoot !== this.config.repositoryRoot) throw failure("repository_root_mismatch")

    const localBase = await this.git(["rev-parse", "--verify", `${baseCommit}^{commit}`], this.config.repositoryRoot)
    if (localBase.exitCode !== 0 || localBase.stdout.trim() !== baseCommit) throw failure("repository_unavailable")

    const unsafeLocalConfig = await this.git(
      [
        "config",
        "--local",
        "--get-regexp",
        "^(filter\\..*\\.(clean|smudge|process)|url\\..*\\.(insteadof|pushinsteadof)|include(if)?\\..*|credential\\..*|http\\..*\\.proxy)$",
      ],
      this.config.repositoryRoot,
      { acceptableExitCodes: [0, 1] },
    )
    if ((unsafeLocalConfig.exitCode !== 0 && unsafeLocalConfig.exitCode !== 1) || unsafeLocalConfig.stdout.length > 0) {
      throw failure("repository_filter_forbidden")
    }

    const fetchUrl = await this.git(["remote", "get-url", this.config.remoteName], this.config.repositoryRoot)
    const pushUrl = await this.git(["remote", "get-url", "--push", this.config.remoteName], this.config.repositoryRoot)
    if (fetchUrl.exitCode !== 0
      || pushUrl.exitCode !== 0
      || fetchUrl.stdout.trim() !== this.config.expectedRemoteUrl
      || pushUrl.stdout.trim() !== this.config.expectedRemoteUrl) throw failure("remote_url_mismatch")

    const remoteBase = await this.readRemoteRef(this.config.defaultBranch)
    if (remoteBase === null) throw failure("remote_base_unavailable")
    if (remoteBase !== baseCommit) throw failure("remote_base_mismatch")
  }

  private async requireCleanWorktree(worktreePath: string, baseCommit: string): Promise<void> {
    const head = await this.git(["rev-parse", "--verify", "HEAD"], worktreePath)
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktreePath)
    if (head.exitCode !== 0 || head.stdout.trim() !== baseCommit || status.exitCode !== 0 || status.stdout.length !== 0) {
      throw failure("worktree_initialization_failed")
    }
  }

  private async applyVerifiedPatch(worktreePath: string, input: PublishVerifiedBranchInput): Promise<void> {
    const checked = await this.git(
      ["apply", "--check", "--index", "--binary", "--whitespace=nowarn", "-"],
      worktreePath,
      { stdin: input.unifiedDiff, acceptableExitCodes: [0, 1], failureCode: "patch_apply_failed" },
    )
    if (checked.exitCode !== 0) throw failure("patch_apply_failed")
    const applied = await this.git(
      ["apply", "--index", "--binary", "--whitespace=nowarn", "-"],
      worktreePath,
      { stdin: input.unifiedDiff, acceptableExitCodes: [0, 1], failureCode: "patch_apply_failed" },
    )
    if (applied.exitCode !== 0) throw failure("patch_apply_failed")

    const names = await this.git(
      ["diff", "--cached", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--"],
      worktreePath,
    )
    const actual = names.stdout.split("\0").filter(Boolean).sort(compareCodeUnits)
    if (names.exitCode !== 0
      || actual.length !== input.changedFiles.length
      || actual.some((path, index) => path !== input.changedFiles[index])) throw failure("changed_files_mismatch")
  }

  private async readRemoteRef(branch: string): Promise<string | null> {
    const reference = `refs/heads/${branch}`
    const result = await this.git(
      ["ls-remote", "--exit-code", this.config.expectedRemoteUrl, reference],
      this.config.repositoryRoot,
      { authenticated: true, acceptableExitCodes: [0, 2], failureCode: "git_command_failed" },
    )
    if (result.exitCode === 2 && result.stdout.trim().length === 0) return null
    const lines = result.stdout.trim().split("\n")
    if (result.exitCode !== 0 || result.stdout.trim().length === 0 || lines.length !== 1) {
      throw failure("git_command_failed")
    }
    const [objectId, reportedRef, ...rest] = lines[0]!.split("\t")
    if (rest.length > 0 || reportedRef !== reference || !isObjectId(objectId)) throw failure("git_command_failed")
    return objectId
  }

  private async cleanup(worktreePath: string, registered: boolean): Promise<void> {
    assertOwnedPath(this.config.scratchParent, worktreePath)
    let failed = false
    if (registered) {
      try {
        const removed = await this.git(
          ["worktree", "remove", "--force", worktreePath],
          this.config.repositoryRoot,
          { acceptableExitCodes: [0, 1], failureCode: "worktree_cleanup_failed" },
        )
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
      const pruned = await this.git(
        ["worktree", "prune"],
        this.config.repositoryRoot,
        { acceptableExitCodes: [0, 1], failureCode: "worktree_cleanup_failed" },
      )
      if (pruned.exitCode !== 0) failed = true
    } catch {
      failed = true
    }
    if (failed) throw failure("worktree_cleanup_failed")
  }

  private async git(args: string[], cwd: string, options: GitOptions = {}): Promise<GitCommandRunnerResult> {
    const env = sanitizedEnvironment(options.authenticated === true ? this.config : undefined)
    Object.assign(env, options.extraEnv ?? {})
    let result: GitCommandRunnerResult
    try {
      result = await this.config.runner.run({
        argv: [
          "git",
          "-c", "core.hooksPath=/dev/null",
          "-c", "core.fsmonitor=false",
          ...(options.authenticated === true
            ? ["-c", "credential.helper=", "-c", "http.proxy=", "-c", "http.https://github.com/.proxy=", "-c", "http.followRedirects=false"]
            : []),
          ...args,
        ],
        cwd,
        env,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        timeoutMs: this.config.commandTimeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
      })
    } catch (error) {
      if (error instanceof GitCliBranchPublisherError) throw error
      throw failure(options.failureCode ?? "git_command_failed")
    }
    const acceptable = options.acceptableExitCodes ?? [0]
    if (!Number.isSafeInteger(result.exitCode)
      || result.exitCode < 0
      || result.exitCode > 255
      || typeof result.stdout !== "string"
      || new TextEncoder().encode(result.stdout).length > this.config.maxOutputBytes) {
      throw failure("git_command_output_exceeded")
    }
    if (!options.allowNonZero && !acceptable.includes(result.exitCode)) {
      throw failure(options.failureCode ?? "git_command_failed")
    }
    return result
  }
}

function validateConfig(config: GitCliBranchPublisherConfig): ValidatedConfig {
  try {
    if (!config || typeof config !== "object") throw new Error()
    const repositoryRoot = canonicalDirectory(config.repositoryRoot)
    const scratchParent = canonicalDirectory(config.scratchParent)
    if (!repositoryRoot || !scratchParent || pathsOverlap(repositoryRoot, scratchParent)) throw new Error()
    if (!safeToken(config.token)
      || !safeName(config.owner)
      || !safeName(config.repository)
      || !safeRemoteName(config.remoteName)
      || !safeBranch(config.defaultBranch)) throw new Error()
    if (!Number.isSafeInteger(config.commandTimeoutMs)
      || config.commandTimeoutMs < 100
      || config.commandTimeoutMs > 300_000) throw new Error()
    if (!Number.isSafeInteger(config.maxOutputBytes)
      || config.maxOutputBytes < 1_024
      || config.maxOutputBytes > 512 * 1024) throw new Error()
    if (config.runner !== undefined && typeof config.runner.run !== "function") throw new Error()
    return {
      ...config,
      repositoryRoot,
      scratchParent,
      expectedRemoteUrl: `https://github.com/${config.owner}/${config.repository}.git`,
      runner: config.runner ?? defaultRunner,
    }
  } catch {
    throw failure("invalid_publisher_config")
  }
}

function validateInput(input: PublishVerifiedBranchInput, defaultBranch: string): PublishVerifiedBranchInput {
  try {
    if (!input || typeof input !== "object") throw new Error()
    if (!isObjectId(input.baseCommit)
      || !isObjectId(input.resultTreeOid)
      || input.baseCommit.length !== input.resultTreeOid.length) throw new Error()
    if (typeof input.unifiedDiff !== "string"
      || input.unifiedDiff.length === 0
      || input.unifiedDiff.length > 512 * 1024
      || input.unifiedDiff.includes("\0")
      || input.unifiedDiff.includes("\r")
      || !input.unifiedDiff.startsWith("diff --git ")) throw new Error()
    if (!/^[a-f0-9]{64}$/.test(input.patchSha256)
      || createHash("sha256").update(input.unifiedDiff).digest("hex") !== input.patchSha256) throw new Error()
    if (!Array.isArray(input.changedFiles)
      || input.changedFiles.length === 0
      || input.changedFiles.length > 100
      || !input.changedFiles.every(safeRelativePath)
      || new Set(input.changedFiles).size !== input.changedFiles.length) throw new Error()
    const changedFiles = [...input.changedFiles].sort(compareCodeUnits)
    if (input.headBranch === defaultBranch
      || !/^podo\/remediation-[a-f0-9]{16,64}$/.test(input.headBranch)
      || !safeBranch(input.headBranch)) throw failure("unsafe_head_branch")
    if (typeof input.commitMessage !== "string"
      || input.commitMessage.length === 0
      || input.commitMessage.length > 10_000
      || input.commitMessage !== input.commitMessage.trim()
      || input.commitMessage.includes("\0")
      || input.commitMessage.includes("\r")) throw new Error()
    if (typeof input.commitTimestamp !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.commitTimestamp)
      || new Date(input.commitTimestamp).toISOString() !== input.commitTimestamp) throw new Error()
    return { ...input, changedFiles }
  } catch (error) {
    if (error instanceof GitCliBranchPublisherError) throw error
    throw failure("invalid_publish_input")
  }
}

const defaultRunner: GitCommandRunner = {
  async run(input) {
    let child: Bun.Subprocess<"pipe", "pipe", "pipe">
    try {
      child = Bun.spawn(input.argv, {
        cwd: input.cwd,
        env: input.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      child.stdin.write(input.stdin ?? "")
      child.stdin.end()
    } catch {
      throw failure("git_command_failed")
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill(9) } catch {}
    }, input.timeoutMs)
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        capture(child.stdout, input.maxOutputBytes),
        capture(child.stderr, input.maxOutputBytes),
      ])
      if (timedOut) throw failure("git_command_timeout")
      if (stdout.exceeded || stderr.exceeded) throw failure("git_command_output_exceeded")
      return { exitCode, stdout: new TextDecoder().decode(stdout.bytes) }
    } finally {
      clearTimeout(timer)
    }
  },
}

async function capture(stream: ReadableStream<Uint8Array>, limit: number): Promise<{ bytes: Uint8Array; exceeded: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let captured = 0
  let exceeded = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (captured + value.byteLength > limit) {
        exceeded = true
        const remaining = Math.max(0, limit - captured)
        if (remaining > 0) chunks.push(value.subarray(0, remaining))
        captured = limit
      } else {
        chunks.push(value)
        captured += value.byteLength
      }
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

function sanitizedEnvironment(authenticated?: ValidatedConfig): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null"
  env.GIT_CONFIG_NOSYSTEM = "1"
  env.GIT_TERMINAL_PROMPT = "0"
  env.GCM_INTERACTIVE = "Never"
  if (authenticated) {
    env.GIT_CONFIG_COUNT = "1"
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader"
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${authenticated.token}`).toString("base64")}`
  }
  return env
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

function assertOwnedPath(parent: string, path: string): void {
  const child = relative(parent, path)
  if (child.length === 0
    || child.startsWith("..")
    || child.includes("/")
    || !/^podo-github-publish-[a-f0-9-]+$/.test(child)) throw failure("worktree_cleanup_failed")
}

function safeName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_.-]+$/.test(value)
}

function safeRemoteName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
}

function safeToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= 4_096
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function safeBranch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".")
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.startsWith("/")
    || value.includes("\\")) return false
  return value.split("/").every((segment) => /^[A-Za-z0-9._@+-]+$/.test(segment) && segment !== "." && segment !== "..")
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function failure(code: GitCliBranchPublisherErrorCode): GitCliBranchPublisherError {
  return new GitCliBranchPublisherError(code)
}
