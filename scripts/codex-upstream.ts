import { resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "..")
const codexDirectory = resolve(repositoryRoot, "vendor/codex")
const command = process.argv[2] ?? "status"

async function run(args: string[], options: { capture?: boolean } = {}): Promise<string> {
  const capture = options.capture ?? false
  const processHandle = Bun.spawn(args, {
    cwd: repositoryRoot,
    stdin: "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  })

  const outputPromise = capture ? new Response(processHandle.stdout).text() : Promise.resolve("")
  const [exitCode, output] = await Promise.all([processHandle.exited, outputPromise])

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${args.join(" ")}`)
  }

  return output.trim()
}

async function status(): Promise<void> {
  const [pinnedCommit, exactTag, upstreamCommit] = await Promise.all([
    run(["git", "-C", codexDirectory, "rev-parse", "HEAD"], { capture: true }),
    run(["git", "-C", codexDirectory, "describe", "--tags", "--exact-match", "HEAD"], { capture: true }).catch(
      () => "untagged",
    ),
    run(["git", "ls-remote", "https://github.com/openai/codex.git", "refs/heads/main"], { capture: true }).then(
      (line) => line.split(/\s+/)[0] ?? "unknown",
    ),
  ])

  console.log(
    JSON.stringify(
      {
        path: "vendor/codex",
        pinnedCommit,
        exactTag,
        upstreamMain: upstreamCommit,
        atUpstreamMain: pinnedCommit === upstreamCommit,
      },
      null,
      2,
    ),
  )
}

async function update(): Promise<void> {
  await run(["git", "-C", codexDirectory, "fetch", "--depth", "1", "origin", "main"])
  await run(["git", "-C", codexDirectory, "checkout", "--detach", "FETCH_HEAD"])
  await run(["bun", "run", "codex:generate"])
  await run(["bun", "run", "codex:smoke"])
  await status()
}

if (command === "status") {
  await status()
} else if (command === "update") {
  await update()
} else {
  throw new Error(`Unknown command: ${command}. Expected "status" or "update".`)
}
