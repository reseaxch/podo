import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readdir, realpath, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  GitCliBranchPublisher,
  GitCliBranchPublisherError,
  type GitCommandRunner,
  type GitCommandRunnerInput,
  type PublishVerifiedBranchInput,
} from "./git-branch-publisher"

const temporaryRoots: string[] = []
const token = "github-secret-token-never-expose"

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("GitCliBranchPublisher", () => {
  test("reconstructs the verified tree, publishes a deterministic non-default commit, and reuses it", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const runner = redirectingRunner(fixture, captured)
    const publisher = new GitCliBranchPublisher(config(fixture, runner))

    const first = await publisher.publish(fixture.input)
    const repeated = await publisher.publish(fixture.input)

    expect(first).toEqual({
      headCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      resultTreeOid: fixture.input.resultTreeOid,
      status: "created",
    })
    expect(repeated).toEqual({ ...first, status: "reused" })
    expect(await gitBare(fixture.bareRemote, ["rev-parse", `refs/heads/${fixture.input.headBranch}`])).toBe(first.headCommit)
    expect(await gitBare(fixture.bareRemote, ["show", "-s", "--format=%T", first.headCommit])).toBe(fixture.input.resultTreeOid)
    expect(await gitBare(fixture.bareRemote, ["show", "-s", "--format=%P", first.headCommit])).toBe(fixture.baseCommit)
    expect(await git(fixture.repositoryRoot, ["rev-parse", "refs/heads/main"])).toBe(fixture.baseCommit)
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([await realpath(fixture.repositoryRoot)])

    const pushes = captured.filter(({ argv }) => argv.includes("push"))
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.argv).toContain(`--force-with-lease=refs/heads/${fixture.input.headBranch}:`)
    expect(pushes[0]?.argv.at(-1)).toBe(`${first.headCommit}:refs/heads/${fixture.input.headBranch}`)
    expect(captured.every(({ argv }) => !argv.join("\0").includes(token))).toBe(true)
    expect(captured.every(({ env }) => env.AWS_SECRET_ACCESS_KEY === undefined && env.GITHUB_TOKEN === undefined)).toBe(true)
    expect(captured.filter(({ argv }) => argv.includes("ls-remote") || argv.includes("push")))
      .toSatisfy((commands: GitCommandRunnerInput[]) => commands.every(({ env }) =>
        Object.values(env).some((value) => value?.startsWith("AUTHORIZATION: basic ")),
      ))
  })

  test("rejects a remote base mismatch before creating a worktree or publishing", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const runner = redirectingRunner(fixture, captured, { initialBaseCommit: "f".repeat(40) })
    const publisher = new GitCliBranchPublisher(config(fixture, runner))

    await expect(publisher.publish(fixture.input)).rejects.toMatchObject({ code: "remote_base_mismatch" })

    expect(captured.some(({ argv }) => argv.includes("worktree") && argv.includes("add"))).toBe(false)
    expect(captured.some(({ argv }) => argv.includes("push"))).toBe(false)
    expect(await readdir(fixture.scratchParent)).toEqual([])
  })

  test("rejects a reconstructed tree mismatch and always cleans the owned worktree", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const publisher = new GitCliBranchPublisher(config(fixture, redirectingRunner(fixture, captured)))

    await expect(publisher.publish({ ...fixture.input, resultTreeOid: "f".repeat(40) }))
      .rejects.toMatchObject({ code: "result_tree_mismatch" })

    expect(captured.some(({ argv }) => argv.includes("push"))).toBe(false)
    expect(await readdir(fixture.scratchParent)).toEqual([])
    expect(await worktreePaths(fixture.repositoryRoot)).toEqual([await realpath(fixture.repositoryRoot)])
  })

  test("fails closed when the base moves after publishing and leaves only the exact idempotent head", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const runner = redirectingRunner(fixture, captured, { finalBaseCommit: "e".repeat(40) })
    const publisher = new GitCliBranchPublisher(config(fixture, runner))

    await expect(publisher.publish(fixture.input)).rejects.toMatchObject({ code: "remote_base_drifted" })

    const head = await gitBare(fixture.bareRemote, ["rev-parse", `refs/heads/${fixture.input.headBranch}`])
    expect(head).toMatch(/^[a-f0-9]{40}$/)
    expect(captured.filter(({ argv }) => argv.includes("push"))).toHaveLength(1)
    expect(await readdir(fixture.scratchParent)).toEqual([])
  })

  test("reuses only an exact remote head and rejects a conflicting branch without overwriting it", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const publisher = new GitCliBranchPublisher(config(fixture, redirectingRunner(fixture, captured)))
    await publisher.publish(fixture.input)
    await gitBare(fixture.bareRemote, ["update-ref", `refs/heads/${fixture.input.headBranch}`, fixture.baseCommit])
    captured.length = 0

    await expect(publisher.publish(fixture.input)).rejects.toMatchObject({ code: "remote_head_conflict" })

    expect(captured.some(({ argv }) => argv.includes("push"))).toBe(false)
    expect(await gitBare(fixture.bareRemote, ["rev-parse", `refs/heads/${fixture.input.headBranch}`])).toBe(fixture.baseCommit)
  })

  test("reconciles a lost push response by reading back the exact published commit", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const runner = redirectingRunner(fixture, captured, { reportPushFailureAfterSuccess: true })
    const publisher = new GitCliBranchPublisher(config(fixture, runner))

    const result = await publisher.publish(fixture.input)

    expect(result.status).toBe("reused")
    expect(await gitBare(fixture.bareRemote, ["rev-parse", `refs/heads/${fixture.input.headBranch}`])).toBe(result.headCommit)
    expect(captured.filter(({ argv }) => argv.includes("push"))).toHaveLength(1)
  })

  test("does not fast-forward a branch created by another actor after the empty-head read", async () => {
    const fixture = await createFixture()
    const captured: GitCommandRunnerInput[] = []
    const publisher = new GitCliBranchPublisher(config(
      fixture,
      redirectingRunner(fixture, captured, { raceHeadToBaseBeforePush: true }),
    ))

    await expect(publisher.publish(fixture.input)).rejects.toMatchObject({ code: "remote_head_conflict" })

    expect(await gitBare(fixture.bareRemote, ["rev-parse", `refs/heads/${fixture.input.headBranch}`]))
      .toBe(fixture.baseCommit)
    expect(captured.filter(({ argv }) => argv.includes("push"))).toHaveLength(1)
  })

  test("rejects default or non-derived branches and sanitizes runner errors", async () => {
    const fixture = await createFixture()
    let calls = 0
    const throwingRunner: GitCommandRunner = {
      async run() {
        calls += 1
        throw new Error(`private ${token}`)
      },
    }
    const publisher = new GitCliBranchPublisher(config(fixture, throwingRunner))

    await expect(publisher.publish({ ...fixture.input, headBranch: "main" }))
      .rejects.toMatchObject({ code: "unsafe_head_branch" })
    await expect(publisher.publish({ ...fixture.input, headBranch: "feature/not-derived" }))
      .rejects.toMatchObject({ code: "unsafe_head_branch" })
    expect(calls).toBe(0)

    try {
      await publisher.publish(fixture.input)
      throw new Error("expected publisher failure")
    } catch (error) {
      expect(error).toBeInstanceOf(GitCliBranchPublisherError)
      expect(String(error)).not.toContain(token)
      expect(JSON.stringify(error)).not.toContain(token)
    }
  })

  test("rejects local URL rewrites before any authenticated Git operation", async () => {
    const fixture = await createFixture()
    await git(fixture.repositoryRoot, [
      "config",
      "--local",
      "url.https://attacker.example/.insteadOf",
      "https://github.com/",
    ])
    const captured: GitCommandRunnerInput[] = []
    const publisher = new GitCliBranchPublisher(config(fixture, redirectingRunner(fixture, captured)))

    await expect(publisher.publish(fixture.input)).rejects.toMatchObject({ code: "repository_filter_forbidden" })

    expect(captured.some(({ argv }) => argv.includes("ls-remote") || argv.includes("push"))).toBe(false)
  })
})

interface Fixture {
  parent: string
  repositoryRoot: string
  scratchParent: string
  bareRemote: string
  baseCommit: string
  input: PublishVerifiedBranchInput
}

async function createFixture(): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), "podo-github-publisher-"))
  temporaryRoots.push(parent)
  const repositoryRoot = join(parent, "repository")
  const scratchParent = join(parent, "scratch")
  const bareRemote = join(parent, "remote.git")
  const builder = join(parent, "builder")
  await mkdir(join(repositoryRoot, "src"), { recursive: true })
  await mkdir(join(repositoryRoot, "test"), { recursive: true })
  await mkdir(scratchParent)
  await Bun.write(join(repositoryRoot, "src/value.ts"), "export const value = 0\n")
  await Bun.write(join(repositoryRoot, "test/value.test.ts"), "expect(value).toBe(0)\n")
  await git(repositoryRoot, ["init", "-b", "main"])
  await git(repositoryRoot, ["config", "user.email", "podo@example.invalid"])
  await git(repositoryRoot, ["config", "user.name", "Podo Test"])
  await git(repositoryRoot, ["add", "--", "src/value.ts", "test/value.test.ts"])
  await git(repositoryRoot, ["commit", "-m", "base"])
  const baseCommit = await git(repositoryRoot, ["rev-parse", "HEAD"])
  await command(["git", "init", "--bare", bareRemote], parent)
  await git(repositoryRoot, ["remote", "add", "seed", bareRemote])
  await git(repositoryRoot, ["push", "seed", `${baseCommit}:refs/heads/main`])
  await git(repositoryRoot, ["remote", "remove", "seed"])
  await git(repositoryRoot, ["remote", "add", "origin", "https://github.com/reseaxch/podo.git"])

  await git(repositoryRoot, ["worktree", "add", "--detach", builder, baseCommit])
  await Bun.write(join(builder, "src/value.ts"), "export const value = 1\n")
  await Bun.write(join(builder, "test/value.test.ts"), "expect(value).toBe(1)\n")
  const unifiedDiff = `${await git(builder, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--"])}\n`
  await git(builder, ["add", "--", "src/value.ts", "test/value.test.ts"])
  const resultTreeOid = await git(builder, ["write-tree"])
  await git(repositoryRoot, ["worktree", "remove", "--force", builder])

  return {
    parent,
    repositoryRoot,
    scratchParent,
    bareRemote,
    baseCommit,
    input: {
      baseCommit,
      unifiedDiff,
      patchSha256: createHash("sha256").update(unifiedDiff).digest("hex"),
      changedFiles: ["src/value.ts", "test/value.test.ts"],
      resultTreeOid,
      headBranch: "podo/remediation-0123456789abcdef",
      commitMessage: "fix: apply verified Podo remediation",
      commitTimestamp: "2026-07-15T10:00:00.000Z",
    },
  }
}

function config(fixture: Fixture, runner: GitCommandRunner) {
  return {
    repositoryRoot: fixture.repositoryRoot,
    scratchParent: fixture.scratchParent,
    remoteName: "origin",
    owner: "reseaxch",
    repository: "podo",
    defaultBranch: "main",
    token,
    commandTimeoutMs: 10_000,
    maxOutputBytes: 512 * 1024,
    runner,
  }
}

function redirectingRunner(
  fixture: Fixture,
  captured: GitCommandRunnerInput[],
  overrides: {
    initialBaseCommit?: string
    finalBaseCommit?: string
    reportPushFailureAfterSuccess?: boolean
    raceHeadToBaseBeforePush?: boolean
  } = {},
): GitCommandRunner {
  let baseReads = 0
  let racedHead = false
  return {
    async run(input) {
      captured.push({ ...input, argv: [...input.argv], env: { ...input.env } })
      const argv = [...input.argv]
      const operation = argv.findIndex((argument) => argument === "ls-remote" || argument === "push")
      if (operation >= 0 && argv[operation] === "ls-remote") {
        const reference = argv.at(-1)
        if (reference === "refs/heads/main") {
          baseReads += 1
          const override = baseReads === 1 ? overrides.initialBaseCommit : overrides.finalBaseCommit
          if (override) return { exitCode: 0, stdout: `${override}\trefs/heads/main\n` }
        }
      }
      if (operation >= 0) {
        const remoteIndex = argv.indexOf("https://github.com/reseaxch/podo.git", operation + 1)
        if (remoteIndex >= 0) argv[remoteIndex] = fixture.bareRemote
      }
      if (argv.includes("push") && overrides.raceHeadToBaseBeforePush && !racedHead) {
        racedHead = true
        await gitBare(fixture.bareRemote, ["update-ref", `refs/heads/${fixture.input.headBranch}`, fixture.baseCommit])
      }
      const result = await runCommand({ ...input, argv })
      if (argv.includes("push") && overrides.reportPushFailureAfterSuccess && result.exitCode === 0) {
        return { ...result, exitCode: 1 }
      }
      return result
    },
  }
}

async function runCommand(input: GitCommandRunnerInput) {
  const result = await command(input.argv, input.cwd, input.env, input.stdin)
  return { exitCode: result.exitCode, stdout: result.stdout }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await command(["git", ...args], cwd)
  if (result.exitCode !== 0) throw new Error(`git failed: ${args[0]}`)
  return result.stdout.trim()
}

async function gitBare(repository: string, args: string[]): Promise<string> {
  return git(process.cwd(), ["--git-dir", repository, ...args])
}

async function worktreePaths(repository: string): Promise<string[]> {
  const output = await git(repository, ["worktree", "list", "--porcelain"])
  return output.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length))
}

async function command(
  argv: string[],
  cwd: string,
  env: Record<string, string | undefined> = { ...process.env },
  stdin?: string,
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn(argv, { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  child.stdin.write(stdin ?? "")
  child.stdin.end()
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode, stdout }
}
