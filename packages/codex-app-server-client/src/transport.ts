import type { ClientRequest } from "@podo/codex-protocol/generated/ClientRequest.ts"
import type { InitializeResponse } from "@podo/codex-protocol/generated/InitializeResponse.ts"
import type { RequestId } from "@podo/codex-protocol/generated/RequestId.ts"
import type { ServerNotification } from "@podo/codex-protocol/generated/ServerNotification.ts"
import type { ServerRequest } from "@podo/codex-protocol/generated/ServerRequest.ts"
import type { ThreadReadResponse } from "@podo/codex-protocol/generated/v2/ThreadReadResponse.ts"
import type { ThreadResumeResponse } from "@podo/codex-protocol/generated/v2/ThreadResumeResponse.ts"
import type { ThreadStartResponse } from "@podo/codex-protocol/generated/v2/ThreadStartResponse.ts"
import type { TurnInterruptResponse } from "@podo/codex-protocol/generated/v2/TurnInterruptResponse.ts"
import type { TurnStartResponse } from "@podo/codex-protocol/generated/v2/TurnStartResponse.ts"
import type { TurnSteerResponse } from "@podo/codex-protocol/generated/v2/TurnSteerResponse.ts"

export interface CodexRuntimeInfo {
  binary: string
  version: string
  rawVersion: string
}

export interface CodexAppServerHandshake {
  runtime: CodexRuntimeInfo
  initializeResult: InitializeResponse
}

export interface ProbeCodexOptions {
  binary?: string
  timeoutMs?: number
}

export interface AppServerIo {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  write(data: string): Promise<void>
  closeStdin(): void
  kill(): void
}

export interface AppServerConnectionOptions {
  binary?: string
  launch?: () => AppServerIo
  initializeTimeoutMs?: number
  requestTimeoutMs?: number
  maxStderrBytes?: number
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

type ClientMethod = ClientRequest["method"]
type RequestFor<M extends ClientMethod> = Extract<ClientRequest, { method: M }>
type RequestParams<M extends ClientMethod> = RequestFor<M>["params"]
type ResponseFor<M extends ClientMethod> = M extends "initialize" ? InitializeResponse
  : M extends "thread/start" ? ThreadStartResponse
  : M extends "thread/resume" ? ThreadResumeResponse
  : M extends "thread/read" ? ThreadReadResponse
  : M extends "turn/start" ? TurnStartResponse
  : M extends "turn/steer" ? TurnSteerResponse
  : M extends "turn/interrupt" ? TurnInterruptResponse
  : unknown

interface JsonRpcResponse {
  id: RequestId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface PendingRequest {
  method: string
  resolve(value: unknown): void
  reject(error: Error): void
  cleanup(): void
}

type NotificationListener = (notification: ServerNotification) => void
type ServerRequestListener = (request: ServerRequest) => void
type CloseListener = (error: Error) => void

export class JsonLineDecoder {
  private buffer = ""

  push(chunk: string): unknown[] {
    this.buffer += chunk
    const messages: unknown[] = []
    while (true) {
      const newline = this.buffer.indexOf("\n")
      if (newline < 0) return messages
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) messages.push(JSON.parse(line))
    }
  }

  finish(): unknown[] {
    const line = this.buffer.trim()
    this.buffer = ""
    return line ? [JSON.parse(line)] : []
  }
}

export class AppServerConnection {
  private nextRequestId = 1
  private readonly pending = new Map<RequestId, PendingRequest>()
  private readonly notificationListeners = new Set<NotificationListener>()
  private readonly serverRequestListeners = new Set<ServerRequestListener>()
  private readonly closeListeners = new Set<CloseListener>()
  private readonly requestTimeoutMs: number
  private readonly maxStderrBytes: number
  private stderrTail = ""
  private terminalError: Error | null = null
  private closing = false
  private _initializeResult: InitializeResponse | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private terminationPromise: Promise<void> | null = null

  private constructor(private readonly io: AppServerIo, options: AppServerConnectionOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.maxStderrBytes = options.maxStderrBytes ?? 8_192
    void this.readStdout()
    void this.readStderr()
    void this.watchExit()
  }

  static async connect(options: AppServerConnectionOptions = {}): Promise<AppServerConnection> {
    const io = options.launch?.() ?? launchCodex(options.binary ?? process.env.CODEX_BIN ?? "codex")
    const connection = new AppServerConnection(io, options)
    try {
      connection._initializeResult = await connection.request(
        "initialize",
        {
          clientInfo: { name: "podo", title: "Podo", version: "0.0.0" },
          capabilities: null,
        },
        { timeoutMs: options.initializeTimeoutMs ?? 10_000 },
      )
      await connection.notify("initialized")
      return connection
    } catch (error) {
      await connection.close()
      throw error
    }
  }

  get pendingRequestCount(): number {
    return this.pending.size
  }

  get initializeResult(): InitializeResponse {
    if (!this._initializeResult) throw new Error("Codex app-server connection is not initialized")
    return this._initializeResult
  }

  get diagnostics(): string {
    return this.stderrTail
  }

  request<M extends ClientMethod>(method: M, params: RequestParams<M>, options: RequestOptions = {}): Promise<ResponseFor<M>> {
    if (this.terminalError) return Promise.reject(this.terminalError)
    if (options.signal?.aborted) return Promise.reject(new Error(`Codex request ${method} aborted`))
    const id = this.nextRequestId++
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs

    return new Promise<ResponseFor<M>>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => settleReject(new Error(`Codex request ${method} aborted`))
      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        options.signal?.removeEventListener("abort", onAbort)
      }
      const settleReject = (error: Error) => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.cleanup()
        reject(error)
      }
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as ResponseFor<M>),
        reject,
        cleanup,
      })
      timeout = setTimeout(() => settleReject(new Error(`Codex request ${method} timed out after ${timeoutMs}ms`)), timeoutMs)
      options.signal?.addEventListener("abort", onAbort, { once: true })
      if (options.signal?.aborted) {
        onAbort()
        return
      }
      void this.write({ method, id, params }).catch((error) => settleReject(asError(error)))
    })
  }

  async notify(method: "initialized"): Promise<void> {
    await this.write({ method })
  }

  async respond(id: RequestId, result: unknown): Promise<void> {
    await this.write({ id, result })
  }

  async rejectServerRequest(id: RequestId, code: number, message: string): Promise<void> {
    await this.write({ id, error: { code, message } })
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onServerRequest(listener: ServerRequestListener): () => void {
    this.serverRequestListeners.add(listener)
    return () => this.serverRequestListeners.delete(listener)
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener)
    if (this.terminalError) {
      queueMicrotask(() => {
        try {
          listener(this.terminalError!)
        } catch {
          // Observer failures cannot alter owned-process termination.
        }
      })
    }
    return () => this.closeListeners.delete(listener)
  }

  async close(): Promise<void> {
    if (!this.terminalError) this.fail(new Error("Codex app-server connection closed"), false)
    await this.terminateOwnedIo()
  }

  private async write(message: unknown): Promise<void> {
    this.assertWritable()
    const data = `${JSON.stringify(message)}\n`
    const operation = this.writeQueue.then(() => {
      this.assertWritable()
      return this.io.write(data)
    })
    this.writeQueue = operation.catch(() => undefined)
    try {
      await operation
    } catch (error) {
      const failure = new Error(this.failureMessage(`Codex app-server write failed: ${asError(error).message}`))
      this.fail(failure)
      throw failure
    }
  }

  private async readStdout(): Promise<void> {
    const reader = this.io.stdout.getReader()
    const decoder = new TextDecoder()
    const lines = new JsonLineDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const message of lines.push(decoder.decode(value, { stream: true }))) this.handleMessage(message)
      }
      for (const message of lines.push(decoder.decode())) this.handleMessage(message)
      for (const message of lines.finish()) this.handleMessage(message)
      if (!this.closing) this.fail(new Error(this.failureMessage("Codex app-server stdout reached EOF")))
    } catch (error) {
      if (!this.closing) this.fail(new Error(this.failureMessage(`Codex app-server transport failed: ${asError(error).message}`)))
    } finally {
      reader.releaseLock()
    }
  }

  private async readStderr(): Promise<void> {
    const reader = this.io.stderr.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        this.appendDiagnostic(decoder.decode(value, { stream: true }))
      }
      this.appendDiagnostic(decoder.decode())
    } catch {
      // stdout/exit remains the authoritative connection signal.
    } finally {
      reader.releaseLock()
    }
  }

  private async watchExit(): Promise<void> {
    const code = await this.io.exited.catch(() => -1)
    if (!this.closing) this.fail(new Error(this.failureMessage(`Codex app-server exited with code ${code}`)))
  }

  private handleMessage(value: unknown): void {
    if (!value || typeof value !== "object") throw new Error("JSONL message must be an object")
    const message = value as Record<string, unknown>
    if ((typeof message.id === "number" || typeof message.id === "string") && ("result" in message || "error" in message)) {
      const response = message as unknown as JsonRpcResponse
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      pending.cleanup()
      if (response.error) pending.reject(new Error(`Codex ${pending.method} failed (${response.error.code}): ${response.error.message}`))
      else pending.resolve(response.result)
      return
    }
    if (typeof message.method !== "string") throw new Error("JSONL message has no method")
    if (typeof message.id === "number" || typeof message.id === "string") {
      const request = message as unknown as ServerRequest
      if (this.serverRequestListeners.size === 0) {
        void this.rejectServerRequest(request.id, -32601, `Podo has no handler for ${request.method}`)
      } else {
        for (const listener of this.serverRequestListeners) listener(request)
      }
      return
    }
    for (const listener of this.notificationListeners) listener(message as unknown as ServerNotification)
  }

  private fail(error: Error, notify = true): void {
    if (this.terminalError) return
    this.terminalError = error
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
    void this.terminateOwnedIo()
    if (notify) {
      for (const listener of this.closeListeners) {
        try {
          listener(error)
        } catch {
          // Observer failures cannot alter owned-process termination.
        }
      }
    }
  }

  private terminateOwnedIo(): Promise<void> {
    if (this.terminationPromise) return this.terminationPromise
    this.closing = true
    try {
      this.io.closeStdin()
    } catch {
      // A failed stdin close still falls through to the bounded kill.
    }
    this.terminationPromise = (async () => {
      const exited = await Promise.race([
        this.io.exited.then(() => true, () => true),
        Bun.sleep(250).then(() => false),
      ])
      if (!exited) {
        try {
          this.io.kill()
        } catch {
          // The connection remains terminal even if the process already disappeared.
        }
        await Promise.race([
          this.io.exited.catch(() => undefined),
          Bun.sleep(250),
        ])
      }
    })()
    return this.terminationPromise
  }

  private assertWritable(): void {
    if (this.terminalError || this.closing) {
      throw this.terminalError ?? new Error("Codex app-server connection is closing")
    }
  }

  private appendDiagnostic(chunk: string): void {
    this.stderrTail = (this.stderrTail + chunk).slice(-this.maxStderrBytes)
  }

  private failureMessage(message: string): string {
    const diagnostics = this.stderrTail.trim()
    return diagnostics ? `${message}: ${diagnostics}` : message
  }
}

function launchCodex(binary: string): AppServerIo {
  const child = Bun.spawn([binary, "app-server", "--stdio"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    exited: child.exited,
    async write(data) { child.stdin.write(data); await child.stdin.flush() },
    closeStdin() { child.stdin.end() },
    kill() { child.kill() },
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function parseCodexVersion(output: string): string {
  const match = output.trim().match(/(?:codex-cli\s+)?(\d+\.\d+\.\d+)/)
  if (!match?.[1]) throw new Error(`Unable to parse Codex version from: ${output.trim() || "<empty>"}`)
  return match[1]
}

export async function inspectCodexRuntime(binary = process.env.CODEX_BIN ?? "codex"): Promise<CodexRuntimeInfo> {
  const processHandle = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || `Codex exited with code ${exitCode}`)
  const rawVersion = stdout.trim()
  return { binary, version: parseCodexVersion(rawVersion), rawVersion }
}

export async function probeCodexAppServer(options: ProbeCodexOptions = {}): Promise<CodexAppServerHandshake> {
  const binary = options.binary ?? process.env.CODEX_BIN ?? "codex"
  const runtime = await inspectCodexRuntime(binary)
  const connection = await AppServerConnection.connect({
    binary,
    ...(options.timeoutMs === undefined ? {} : { initializeTimeoutMs: options.timeoutMs }),
  })
  try {
    return { runtime, initializeResult: connection.initializeResult }
  } finally {
    await connection.close()
  }
}
