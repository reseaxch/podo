import { describe, expect, test } from "bun:test"
import { AppServerConnection, JsonLineDecoder, type AppServerIo } from "./index"

function fakeIo(onWrite: (message: Record<string, unknown>, io: ReturnType<typeof createFakeIo>) => void) {
  return createFakeIo(onWrite)
}

function createFakeIo(onWrite: (message: Record<string, unknown>, io: ReturnType<typeof createFakeIo>) => void) {
  let stdoutController!: ReadableStreamDefaultController<Uint8Array>
  let stderrController!: ReadableStreamDefaultController<Uint8Array>
  let resolveExit!: (code: number) => void
  const encoder = new TextEncoder()
  let closeStdinCount = 0
  let killCount = 0
  const io = {
    stdout: new ReadableStream<Uint8Array>({ start(controller) { stdoutController = controller } }),
    stderr: new ReadableStream<Uint8Array>({ start(controller) { stderrController = controller } }),
    exited: new Promise<number>((resolve) => { resolveExit = resolve }),
    async write(data: string) { onWrite(JSON.parse(data.trim()) as Record<string, unknown>, io) },
    closeStdin() { closeStdinCount += 1 },
    kill() { killCount += 1; stdoutController.close(); stderrController.close(); resolveExit(137) },
    send(...chunks: string[]) { for (const chunk of chunks) stdoutController.enqueue(encoder.encode(chunk)) },
    sendStderr(chunk: string) { stderrController.enqueue(encoder.encode(chunk)) },
    fail(code = 1) { stdoutController.close(); stderrController.close(); resolveExit(code) },
    terminationCounts() { return { closeStdinCount, killCount } },
  } satisfies AppServerIo & { send: (...chunks: string[]) => void; sendStderr: (chunk: string) => void; fail: (code?: number) => void; terminationCounts: () => { closeStdinCount: number; killCount: number } }
  return io
}

describe("JsonLineDecoder", () => {
  test("frames partial and multiple JSON lines in order", () => {
    const decoder = new JsonLineDecoder()
    expect(decoder.push('{"id":1')).toEqual([])
    expect(decoder.push('}\n{"id":2}\n{"id"')).toEqual([{ id: 1 }, { id: 2 }])
    expect(decoder.push(':3}\n')).toEqual([{ id: 3 }])
  })
})

describe("AppServerConnection", () => {
  test("initializes once, uses monotonic ids, and routes concurrent responses", async () => {
    const writes: Array<Record<string, unknown>> = []
    const io = fakeIo((message, current) => {
      writes.push(message)
      if (message.method === "initialize") current.send(`${JSON.stringify({ id: message.id, result: { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } })}\n`)
      if (message.method === "thread/read") current.send(`${JSON.stringify({ id: message.id, result: { value: message.id } })}\n`)
    })
    const connection = await AppServerConnection.connect({ launch: () => io })
    const [first, second] = await Promise.all([
      connection.request("thread/read", { threadId: "a", includeTurns: false }),
      connection.request("thread/read", { threadId: "b", includeTurns: false }),
    ])
    expect([first, second] as unknown).toEqual([{ value: 2 }, { value: 3 }])
    expect(writes.map((message) => [message.id, message.method])).toEqual([[1, "initialize"], [undefined, "initialized"], [2, "thread/read"], [3, "thread/read"]])
    await connection.close()
  })

  test("rejects pending requests on EOF and includes bounded diagnostics", async () => {
    const io = fakeIo((message, current) => {
      if (message.method === "initialize") current.send(`${JSON.stringify({ id: 1, result: { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } })}\n`)
    })
    const connection = await AppServerConnection.connect({ launch: () => io })
    const pending = connection.request("thread/read", { threadId: "a", includeTurns: false })
    io.sendStderr("0123456789")
    await Bun.sleep(0)
    io.fail(9)
    await expect(pending).rejects.toThrow(/EOF.*0123456789|exited.*0123456789/)
    expect(connection.pendingRequestCount).toBe(0)
  })

  test("bounds stderr diagnostics", async () => {
    const io = fakeIo((message, current) => {
      if (message.method === "initialize") current.send(`${JSON.stringify({ id: 1, result: { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } })}\n`)
    })
    const connection = await AppServerConnection.connect({ launch: () => io, maxStderrBytes: 5 })
    io.sendStderr("0123456789")
    await Bun.sleep(0)
    expect(connection.diagnostics).toBe("56789")
    await connection.close()
  })

  test("terminates owned IO exactly once after malformed JSON", async () => {
    const io = fakeIo((message, current) => {
      if (message.method === "initialize") current.send(`${JSON.stringify({ id: 1, result: { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } })}\n`)
    })
    const connection = await AppServerConnection.connect({ launch: () => io })
    const closed: Error[] = []
    connection.onClose((error) => closed.push(error))
    const pending = connection.request("thread/read", { threadId: "a", includeTurns: false })
    io.send("{malformed}\n")
    await expect(pending).rejects.toThrow("transport failed")
    await io.exited
    expect(closed).toHaveLength(1)
    expect(io.terminationCounts()).toEqual({ closeStdinCount: 1, killCount: 1 })
    await expect(connection.request("thread/read", { threadId: "b", includeTurns: false })).rejects.toThrow("transport failed")
    await connection.close()
    expect(io.terminationCounts()).toEqual({ closeStdinCount: 1, killCount: 1 })
  })

  test("supports timeout and AbortSignal without leaving pending requests", async () => {
    const io = fakeIo((message, current) => {
      if (message.method === "initialize") current.send(`${JSON.stringify({ id: 1, result: { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } })}\n`)
    })
    const connection = await AppServerConnection.connect({ launch: () => io })
    await expect(connection.request("thread/read", { threadId: "a", includeTurns: false }, { timeoutMs: 5 })).rejects.toThrow("timed out")
    const controller = new AbortController()
    const aborted = connection.request("thread/read", { threadId: "b", includeTurns: false }, { signal: controller.signal })
    controller.abort()
    await expect(aborted).rejects.toThrow("aborted")
    expect(connection.pendingRequestCount).toBe(0)
    await connection.close()
  })

  test("surfaces notifications and server requests without auto-approving", async () => {
    const io = fakeIo((message, current) => {
      if (message.method === "initialize") current.send(`${JSON.stringify({ id: 1, result: { userAgent: "test", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } })}\n`)
    })
    const connection = await AppServerConnection.connect({ launch: () => io })
    const notifications: string[] = []
    const requests: string[] = []
    connection.onNotification((notification) => notifications.push(notification.method))
    connection.onServerRequest((request) => requests.push(request.method))
    io.send(
      `${JSON.stringify({ method: "warning", params: { message: "careful" } })}\n${JSON.stringify({ id: "approval-1", method: "item/fileChange/requestApproval", params: { threadId: "t", turnId: "v", itemId: "i", startedAtMs: 1 } })}\n`,
    )
    await Bun.sleep(0)
    expect(notifications).toEqual(["warning"])
    expect(requests).toEqual(["item/fileChange/requestApproval"])
    await connection.respond("approval-1", { decision: "decline" })
    await connection.close()
  })
})
