import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, readdir, realpath, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { IncidentRemediationExecutorInput } from "./incident-remediation"
import {
  LocalWorktreeRemediationExecutor,
  type RemediationPatchProducer,
} from "./local-worktree-remediation-executor"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("LocalWorktreeRemediationExecutor", () => {
  test("proves red then green in a detached worktree and returns the exact verified diff", async () => {
    const fixture = await createRepository()
    const trustedBaseCommit = await git(fixture.repositoryRoot, ["rev-parse", "HEAD"])
    const sourceIndexBefore = new Uint8Array(await Bun.file(join(fixture.repositoryRoot, ".git/index")).arrayBuffer())
    const sourceObjectsBefore = await directoryFiles(join(fixture.repositoryRoot, ".git/objects"))
    await Bun.write(join(fixture.repositoryRoot, "local-uncommitted.txt"), "must remain untouched\n")
    const hookDirectory = join(fixture.parent, "hooks")
    const hookMarker = join(fixture.parent, "hook-executed")
    await mkdir(hookDirectory)
    await Bun.write(join(hookDirectory, "post-checkout"), `#!/bin/sh\ntouch ${hookMarker}\n`)
    await chmod(join(hookDirectory, "post-checkout"), 0o755)
    await git(fixture.repositoryRoot, ["config", "core.hooksPath", hookDirectory])
    const phases: string[] = []
    let worktreeBranch: string | undefined
    let worktreeHead: string | undefined
    let stagedBeforeFix: string | undefined
    const producer: RemediationPatchProducer = {
      async writeRegression({ worktreePath }) {
        phases.push("regression")
        worktreeBranch = await git(worktreePath, ["branch", "--show-current"])
        worktreeHead = await git(worktreePath, ["rev-parse", "HEAD"])
        await Bun.write(join(worktreePath, "test/cache.test.ts"), [
          'import { expect, test } from "bun:test"',
          'import { cacheLimit } from "../src/cache"',
          'test("cache is bounded", () => expect(cacheLimit).toBe(10))',
          "",
        ].join("\n"))
      },
      async applyFix({ worktreePath }) {
        phases.push("fix")
        stagedBeforeFix = await git(worktreePath, ["diff", "--cached", "--name-only"])
        await Bun.write(join(worktreePath, "src/cache.ts"), "export const cacheLimit = 10\n")
      },
    }
    const executor = new LocalWorktreeRemediationExecutor(config(fixture, producer))

    const result = await executor.execute(input("incident/../../not-a-path; touch escaped"))

    expect(phases).toEqual(["regression", "fix"])
    expect(worktreeBranch).toBe("")
    expect(worktreeHead).toBe(trustedBaseCommit)
    expect(stagedBeforeFix).toBe("")
    expect(result).toMatchObject({
      provenance: {
        baseRef: "main",
        baseCommit: trustedBaseCommit,
      },
      regression: { prePatch: "failed", postPatch: "passed" },
      validation: { status: "passed", checks: ["validation-1"] },
      patch: { changedFiles: ["src/cache.ts", "test/cache.test.ts"] },
      pullRequestPreview: {
        baseBranch: "github-main",
        headBranch: expect.stringMatching(/^podo\/remediation-[a-f0-9]{16}$/),
      },
    })
    expect(result.patch.unifiedDiff).toContain("diff --git a/src/cache.ts b/src/cache.ts")
    expect(result.patch.unifiedDiff).toContain("diff --git a/test/cache.test.ts b/test/cache.test.ts")
    expect(result.patch.unifiedDiff).toContain("cacheLimit = 10")
    expect(result.patch.unifiedDiff).toContain("cache is bounded")
    expect(result.provenance.resultTreeOid).toMatch(/^[a-f0-9]{40,64}$/)
    expect(result.provenance.resultTreeOid).toBe(await treeAfterApplying(
      fixture.repositoryRoot,
      trustedBaseCommit,
      result.patch.unifiedDiff,
      fixture.parent,
    ))
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([toGitPath(await realpath(fixture.repositoryRoot))])
    expect(await Bun.file(join(fixture.repositoryRoot, "src/cache.ts")).text()).toBe("export const cacheLimit = 0\n")
    expect(await Bun.file(join(fixture.repositoryRoot, "local-uncommitted.txt")).text()).toBe("must remain untouched\n")
    expect(new Uint8Array(await Bun.file(join(fixture.repositoryRoot, ".git/index")).arrayBuffer())).toEqual(sourceIndexBefore)
    expect(await directoryFiles(join(fixture.repositoryRoot, ".git/objects"))).toEqual(sourceObjectsBefore)
    expect(await Bun.file(join(fixture.parent, "escaped")).exists()).toBe(false)
    expect(await Bun.file(hookMarker).exists()).toBe(false)

    const repeated = await executor.execute(input("incident/../../not-a-path; touch escaped"))
    expect(repeated.provenance).toEqual(result.provenance)
    expect(repeated.patch).toEqual(result.patch)
    expect(repeated.pullRequestPreview).toEqual(result.pullRequestPreview)
  })

  test("throws a sanitized error and cleans the owned worktree when validation fails", async () => {
    const fixture = await createRepository()
    const producer = successfulProducer()
    const executor = new LocalWorktreeRemediationExecutor({
      ...config(fixture, producer),
      validationCommands: [[process.execPath, "-e", "process.exit(9)"]],
    })

    await expect(executor.execute(input())).rejects.toThrow("remediation_validation_failed")
    await expect(executor.execute(input())).rejects.not.toThrow("process.exit")
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([toGitPath(await realpath(fixture.repositoryRoot))])
  })

  test("rejects a passing post-patch regression command that mutates the candidate patch", async () => {
    const fixture = await createRepository()
    const executor = new LocalWorktreeRemediationExecutor({
      ...config(fixture, successfulProducer()),
      regressionCommand: [process.execPath, "-e", [
        'const path = "src/cache.ts"',
        "const source = await Bun.file(path).text()",
        'if (source.includes("cacheLimit = 0")) process.exit(1)',
        'await Bun.write(path, "export const cacheLimit = 11\\n")',
      ].join(";")],
    })

    const execution = executor.execute(input())
    await expect(execution).rejects.toThrow("verification_command_mutated_worktree")
    await expect(execution).rejects.not.toThrow("cacheLimit = 11")
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([toGitPath(await realpath(fixture.repositoryRoot))])
    expect(await Bun.file(join(fixture.repositoryRoot, "src/cache.ts")).text()).toBe("export const cacheLimit = 0\n")
  })

  test("rejects a passing validation command that adds an untracked file", async () => {
    const fixture = await createRepository()
    const executor = new LocalWorktreeRemediationExecutor({
      ...config(fixture, successfulProducer()),
      validationCommands: [[
        process.execPath,
        "-e",
        'await Bun.write("validation-output.txt", "must not enter the artifact\\n")',
      ]],
    })

    const execution = executor.execute(input())
    await expect(execution).rejects.toThrow("verification_command_mutated_worktree")
    await expect(execution).rejects.not.toThrow("validation-output.txt")
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([toGitPath(await realpath(fixture.repositoryRoot))])
    expect(await Bun.file(join(fixture.repositoryRoot, "validation-output.txt")).exists()).toBe(false)
  })

  test("passes argv literally and rejects repository and scratch path escapes", async () => {
    const fixture = await createRepository()
    const injectedPath = join(fixture.parent, "command-injected")
    const executor = new LocalWorktreeRemediationExecutor({
      ...config(fixture, successfulProducer()),
      validationCommands: [[process.execPath, "-e", "process.exit(0)", `;touch ${injectedPath}`]],
    })

    await expect(executor.execute(input())).resolves.toMatchObject({ validation: { status: "passed" } })
    expect(await Bun.file(injectedPath).exists()).toBe(false)

    expect(() => new LocalWorktreeRemediationExecutor({
      ...config(fixture, successfulProducer()),
      repositoryRoot: join(fixture.repositoryRoot, ".."),
    })).toThrow("invalid_remediation_executor_config")
    expect(() => new LocalWorktreeRemediationExecutor({
      ...config(fixture, successfulProducer()),
      scratchParent: "../scratch",
    })).toThrow("invalid_remediation_executor_config")
    expect(() => new LocalWorktreeRemediationExecutor({
      ...config(fixture, successfulProducer()),
      trustedBaseRef: "--upload-pack=touch",
    })).toThrow("invalid_remediation_executor_config")

    await git(fixture.repositoryRoot, ["config", "filter.unsafe.smudge", "touch should-not-run"])
    const filtered = new LocalWorktreeRemediationExecutor(config(fixture, successfulProducer()))
    await expect(filtered.execute(input())).rejects.toThrow("repository_external_filter_forbidden")
    expect(await Bun.file(join(fixture.parent, "should-not-run")).exists()).toBe(false)
  })

  test("caps command duration and captured output and still cleans up", async () => {
    const timeoutFixture = await createRepository()
    const timeoutExecutor = new LocalWorktreeRemediationExecutor({
      ...config(timeoutFixture, successfulProducer()),
      validationCommands: [[process.execPath, "-e", "await new Promise((resolve) => setTimeout(resolve, 1000))"]],
      commandTimeoutMs: 100,
    })
    await expect(timeoutExecutor.execute(input())).rejects.toThrow("remediation_command_timeout")
    expect(await readdir(timeoutFixture.scratchParent)).toEqual([])

    const outputFixture = await createRepository()
    const outputExecutor = new LocalWorktreeRemediationExecutor({
      ...config(outputFixture, successfulProducer()),
      regressionCommand: [process.execPath, "-e", 'console.log("x".repeat(2048)); process.exit(1)'],
      maxOutputBytes: 1024,
    })
    await expect(outputExecutor.execute(input())).rejects.toThrow("remediation_command_output_exceeded")
    expect(await readdir(outputFixture.scratchParent)).toEqual([])
  })

  test("rejects a fix that weakens or rewrites the failing regression", async () => {
    const fixture = await createRepository()
    const producer = successfulProducer()
    const executor = new LocalWorktreeRemediationExecutor({
      ...config(fixture, {
        ...producer,
        async applyFix({ worktreePath }) {
          await Bun.write(join(worktreePath, "src/cache.ts"), "export const cacheLimit = 10\n")
          await Bun.write(join(worktreePath, "test/cache.test.ts"), [
            'import { expect, test } from "bun:test"',
            'test("weakened", () => expect(true).toBe(true))',
            "",
          ].join("\n"))
        },
      }),
    })

    await expect(executor.execute(input())).rejects.toThrow("fix_mutated_regression")
    expect(await readdir(fixture.scratchParent)).toEqual([])
  })

  test("disposes producer state before cleaning a worktree when the pre-patch regression unexpectedly passes", async () => {
    const fixture = await createRepository()
    let disposeCalls = 0
    let worktreeExistedDuringDispose = false
    let applyFixCalls = 0
    const producer: RemediationPatchProducer = {
      async writeRegression({ worktreePath }) {
        await Bun.write(join(worktreePath, "test/cache.test.ts"), [
          'import { expect, test } from "bun:test"',
          'import { cacheLimit } from "../src/cache"',
          'test("current cache value", () => expect(cacheLimit).toBe(0))',
          "",
        ].join("\n"))
      },
      async applyFix() { applyFixCalls += 1 },
      async dispose({ worktreePath }) {
        disposeCalls += 1
        worktreeExistedDuringDispose = (await stat(worktreePath)).isDirectory()
      },
    }
    const executor = new LocalWorktreeRemediationExecutor(config(fixture, producer))

    await expect(executor.execute(input())).rejects.toThrow("regression_did_not_fail_before_patch")

    expect(applyFixCalls).toBe(0)
    expect(disposeCalls).toBe(1)
    expect(worktreeExistedDuringDispose).toBe(true)
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([toGitPath(await realpath(fixture.repositoryRoot))])
  })

  test("still cleans the owned worktree when producer disposal throws", async () => {
    const fixture = await createRepository()
    const producer: RemediationPatchProducer = {
      ...successfulProducer(),
      async dispose() { throw new Error("private dispose detail") },
    }
    const executor = new LocalWorktreeRemediationExecutor(config(fixture, producer))
    const result = executor.execute(input())

    await expect(result).rejects.toThrow("producer_dispose_failed")
    await expect(result).rejects.not.toThrow("private dispose detail")
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([toGitPath(await realpath(fixture.repositoryRoot))])
  })
})

function successfulProducer(): RemediationPatchProducer {
  return {
    async writeRegression({ worktreePath }) {
      await Bun.write(join(worktreePath, "test/cache.test.ts"), [
        'import { expect, test } from "bun:test"',
        'import { cacheLimit } from "../src/cache"',
        'test("cache is bounded", () => expect(cacheLimit).toBe(10))',
        "",
      ].join("\n"))
    },
    async applyFix({ worktreePath }) {
      await Bun.write(join(worktreePath, "src/cache.ts"), "export const cacheLimit = 10\n")
    },
  }
}

interface RepositoryFixture {
  parent: string
  repositoryRoot: string
  scratchParent: string
}

async function createRepository(): Promise<RepositoryFixture> {
  const parent = await mkdtemp(join(tmpdir(), "podo-remediation-executor-"))
  temporaryRoots.push(parent)
  const repositoryRoot = join(parent, "repository")
  const scratchParent = join(parent, "scratch")
  await mkdir(join(repositoryRoot, "src"), { recursive: true })
  await mkdir(join(repositoryRoot, "test"), { recursive: true })
  await mkdir(scratchParent)
  await Bun.write(join(repositoryRoot, "src/cache.ts"), "export const cacheLimit = 0\n")
  await Bun.write(join(repositoryRoot, "test/.gitkeep"), "")
  await git(repositoryRoot, ["init", "-b", "main"])
  await git(repositoryRoot, ["config", "user.email", "podo@example.invalid"])
  await git(repositoryRoot, ["config", "user.name", "Podo Test"])
  await git(repositoryRoot, ["add", "--", "src/cache.ts", "test/.gitkeep"])
  await git(repositoryRoot, ["commit", "-m", "fixture"])
  return { parent, repositoryRoot, scratchParent }
}

function config(fixture: RepositoryFixture, producer: RemediationPatchProducer) {
  return {
    repositoryRoot: fixture.repositoryRoot,
    trustedBaseRef: "main",
    pullRequestBaseBranch: "github-main",
    scratchParent: fixture.scratchParent,
    regressionCommand: [process.execPath, "test", "test/cache.test.ts"],
    validationCommands: [[process.execPath, "test", "test/cache.test.ts"]],
    commandTimeoutMs: 10_000,
    maxOutputBytes: 256 * 1024,
    producer,
  }
}

function input(id = "incident-1"): IncidentRemediationExecutorInput {
  return {
    incident: {
      id,
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
      evidenceIds: ["ev:1"],
      diagnosis: {
        status: "validated",
        schemaVersion: "podo.diagnosis.v1",
        summary: "Checkout cache grows without a bound",
        affectedService: "checkout-service",
        probableRootCause: "The cache does not evict entries",
        confidence: { value: 9000, scale: "basis_points" },
        evidenceIds: ["ev:1"],
        recommendedAction: "Bound cache retention",
        safeToAttemptFix: true,
      },
    },
    target: "isolated_checkout",
    policy: {
      systemPrompt: "approved remediation policy",
      allowedTools: ["search_code", "apply_patch", "run_test"],
      forbiddenTools: ["create_pull_request"],
    },
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`git fixture failed: ${stderr}`)
  return stdout.trim()
}

async function worktreePaths(repositoryRoot: string): Promise<string[]> {
  const output = await git(repositoryRoot, ["worktree", "list", "--porcelain"])
  return output.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length))
}

// `git worktree list --porcelain` always emits forward-slash paths, while
// realpath() returns native separators (backslashes on Windows). Normalize the
// realpath side to Git's canonical forward-slash form so the comparison holds on
// both Windows and Unix.
function toGitPath(path: string): string {
  return path.replaceAll("\\", "/")
}

async function treeAfterApplying(
  repositoryRoot: string,
  baseCommit: string,
  unifiedDiff: string,
  parent: string,
): Promise<string> {
  const checkout = join(parent, `expected-tree-${crypto.randomUUID()}`)
  const patchPath = join(parent, `expected-patch-${crypto.randomUUID()}.diff`)
  await git(parent, ["clone", "--no-local", "--no-checkout", "--", repositoryRoot, checkout])
  try {
    await git(checkout, ["-c", "core.hooksPath=/dev/null", "checkout", "--detach", baseCommit])
    await Bun.write(patchPath, unifiedDiff)
    await git(checkout, ["apply", "--binary", "--", patchPath])
    await git(checkout, ["add", "--all", "--"])
    return await git(checkout, ["write-tree"])
  } finally {
    await rm(patchPath, { force: true })
    await rm(checkout, { recursive: true, force: true })
  }
}

async function directoryFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await directoryFiles(root, path))
    else files.push(path.slice(root.length + 1))
  }
  return files.sort()
}
