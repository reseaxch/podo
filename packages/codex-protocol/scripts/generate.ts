import { mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { assertProtocolCompatibility } from "../src/compatibility"

const packageRoot = resolve(import.meta.dir, "..")
const typesDirectory = resolve(packageRoot, "src/generated")
const schemaDirectory = resolve(packageRoot, "schema")
const codexBinary = process.env.CODEX_BIN ?? "codex"

async function run(args: string[], capture = false): Promise<string> {
  const processHandle = Bun.spawn(args, {
    cwd: packageRoot,
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

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson)
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    )
  }
  return value
}

async function canonicalizeJson(directory: string): Promise<void> {
  const glob = new Bun.Glob("*.json")
  for await (const relativePath of glob.scan({ cwd: directory, onlyFiles: true })) {
    const path = resolve(directory, relativePath)
    const value = await Bun.file(path).json()
    await Bun.write(path, `${JSON.stringify(sortJson(value), null, 2)}\n`)
  }
}

const [codexVersion, upstreamCommit, upstreamTag] = await Promise.all([
  run([codexBinary, "--version"], true),
  run(["git", "-C", "../../vendor/codex", "rev-parse", "HEAD"], true),
  run(["git", "-C", "../../vendor/codex", "describe", "--tags", "--exact-match", "HEAD"], true),
])
assertProtocolCompatibility(codexVersion, upstreamTag)

await Promise.all([
  rm(typesDirectory, { recursive: true, force: true }),
  rm(schemaDirectory, { recursive: true, force: true }),
])
await Promise.all([mkdir(typesDirectory, { recursive: true }), mkdir(schemaDirectory, { recursive: true })])

await run([codexBinary, "app-server", "generate-ts", "--out", typesDirectory])
await run([codexBinary, "app-server", "generate-json-schema", "--out", schemaDirectory])
await canonicalizeJson(schemaDirectory)

await Bun.write(
  resolve(packageRoot, "metadata.json"),
  `${JSON.stringify(
    {
      generatedBy: codexVersion,
      upstreamCommit,
      upstreamTag,
    },
    null,
    2,
  )}\n`,
)

console.log(`Generated Codex protocol with ${codexVersion}`)
