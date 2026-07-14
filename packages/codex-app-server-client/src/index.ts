export interface CodexRuntimeInfo {
  binary: string
  version: string
  rawVersion: string
}

export interface CodexAppServerHandshake {
  runtime: CodexRuntimeInfo
  initializeResult: Record<string, unknown>
}

export interface ProbeCodexOptions {
  binary?: string
  timeoutMs?: number
}

interface JsonRpcResponse {
  id: number
  result?: Record<string, unknown>
  error?: {
    code: number
    message: string
  }
}

export function parseCodexVersion(output: string): string {
  const match = output.trim().match(/(?:codex-cli\s+)?(\d+\.\d+\.\d+)/)
  if (!match?.[1]) {
    throw new Error(`Unable to parse Codex version from: ${output.trim() || "<empty>"}`)
  }
  return match[1]
}

export async function inspectCodexRuntime(binary = process.env.CODEX_BIN ?? "codex"): Promise<CodexRuntimeInfo> {
  const processHandle = Bun.spawn([binary, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Codex exited with code ${exitCode}`)
  }

  const rawVersion = stdout.trim()
  return {
    binary,
    version: parseCodexVersion(rawVersion),
    rawVersion,
  }
}

async function readJsonLine(stream: ReadableStream<Uint8Array>): Promise<JsonRpcResponse> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        throw new Error("Codex app-server closed stdout before the initialize response")
      }

      buffer += decoder.decode(value, { stream: true })
      const newlineIndex = buffer.indexOf("\n")
      if (newlineIndex >= 0) {
        return JSON.parse(buffer.slice(0, newlineIndex)) as JsonRpcResponse
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function probeCodexAppServer(options: ProbeCodexOptions = {}): Promise<CodexAppServerHandshake> {
  const binary = options.binary ?? process.env.CODEX_BIN ?? "codex"
  const timeoutMs = options.timeoutMs ?? 10_000
  const runtime = await inspectCodexRuntime(binary)
  const processHandle = Bun.spawn([binary, "app-server", "--stdio"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    processHandle.kill()
  }, timeoutMs)

  try {
    processHandle.stdin.write(
      `${JSON.stringify({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: {
            name: "rootline",
            title: "Rootline",
            version: "0.0.0",
          },
        },
      })}\n`,
    )
    await processHandle.stdin.flush()

    const response = await readJsonLine(processHandle.stdout)
    if (response.error) {
      throw new Error(`Codex initialize failed (${response.error.code}): ${response.error.message}`)
    }
    if (response.id !== 1 || !response.result) {
      throw new Error(`Unexpected Codex initialize response: ${JSON.stringify(response)}`)
    }

    processHandle.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`)
    await processHandle.stdin.flush()

    return {
      runtime,
      initializeResult: response.result,
    }
  } finally {
    clearTimeout(timeout)
    if (processHandle.exitCode === null) {
      processHandle.kill()
    }
    await processHandle.exited
    if (timedOut) {
      throw new Error(`Codex app-server initialize timed out after ${timeoutMs}ms`)
    }
  }
}
