import type { RequestId } from "@podo/codex-protocol/generated/RequestId.ts"
import type { ServerNotification } from "@podo/codex-protocol/generated/ServerNotification.ts"
import type { ServerRequest } from "@podo/codex-protocol/generated/ServerRequest.ts"
import type { ThreadResumeParams } from "@podo/codex-protocol/generated/v2/ThreadResumeParams.ts"
import type { ThreadStartParams } from "@podo/codex-protocol/generated/v2/ThreadStartParams.ts"
import type { TurnStartParams } from "@podo/codex-protocol/generated/v2/TurnStartParams.ts"
import type { TurnSteerParams } from "@podo/codex-protocol/generated/v2/TurnSteerParams.ts"
import type { ToolRequestUserInputResponse } from "@podo/codex-protocol/generated/v2/ToolRequestUserInputResponse.ts"
import type { ThreadItem } from "@podo/codex-protocol/generated/v2/ThreadItem.ts"
import { AppServerConnection, type AppServerConnectionOptions, type RequestOptions } from "./transport"

export type CodexApprovalKind = "command" | "file_change" | "permissions" | "user_input"

export type CodexToolKind =
  | "command"
  | "file_change"
  | "mcp"
  | "dynamic"
  | "collaboration"
  | "web_search"
  | "image_view"
  | "sleep"
  | "image_generation"

export type CodexRuntimeEvent =
  | { kind: "thread.started"; threadId: string }
  | { kind: "turn.started"; threadId: string; turnId: string }
  | { kind: "turn.completed"; threadId: string; turnId: string; status: "completed" | "interrupted" | "failed"; error?: string }
  | { kind: "output.delta"; threadId: string; turnId: string; text: string }
  | { kind: "tool.started"; threadId: string; turnId: string; itemId: string; tool: CodexToolKind; inputSummary: string }
  | { kind: "tool.completed"; threadId: string; turnId: string; itemId: string; tool: CodexToolKind; status: "completed" | "failed"; inputSummary: string; outputSummary: string }
  | { kind: "approval.requested"; requestId: RequestId; approvalKind: CodexApprovalKind; threadId: string; turnId: string; itemId: string; reason?: string; command?: string; questions?: unknown[] }
  | { kind: "runtime.error"; message: string; threadId?: string; turnId?: string }

export interface StartCodexThreadInput {
  cwd: string
  sandbox: "read-only" | "workspace-write"
  model?: string
  developerInstructions?: string
}

export interface CodexThreadHandle { threadId: string }
export interface CodexTurnHandle { turnId: string }

type EventListener = (event: CodexRuntimeEvent) => void

export interface CodexRuntime {
  startThread(input: StartCodexThreadInput, options?: RequestOptions): Promise<CodexThreadHandle>
  resumeThread(threadId: string, input: StartCodexThreadInput, options?: RequestOptions): Promise<CodexThreadHandle>
  startTurn(threadId: string, prompt: string, options?: RequestOptions): Promise<CodexTurnHandle>
  steerTurn(threadId: string, turnId: string, prompt: string, options?: RequestOptions): Promise<CodexTurnHandle>
  interruptTurn(threadId: string, turnId: string, options?: RequestOptions): Promise<void>
  resolveApproval(requestId: RequestId, decision: "approve" | "deny", answers?: Record<string, string[]>): Promise<void>
  onEvent(listener: EventListener): () => void
  close(): Promise<void>
}

interface RuntimeTransport {
  request(method: string, params: unknown, options?: RequestOptions): Promise<unknown>
  respond(id: RequestId, result: unknown): Promise<void>
  rejectServerRequest(id: RequestId, code: number, message: string): Promise<void>
  onNotification(listener: (notification: ServerNotification) => void): () => void
  onServerRequest(listener: (request: ServerRequest) => void): () => void
  onClose(listener: (error: Error) => void): () => void
  close(): Promise<void>
}

export class AppServerRuntime implements CodexRuntime {
  private readonly listeners = new Set<EventListener>()
  private readonly approvals = new Map<RequestId, { kind: CodexApprovalKind; method: ServerRequest["method"]; params: Record<string, unknown> }>()

  constructor(private readonly transport: RuntimeTransport) {
    transport.onNotification((notification) => this.handleNotification(notification))
    transport.onServerRequest((request) => this.handleServerRequest(request))
    transport.onClose((error) => this.emit({ kind: "runtime.error", message: error.message }))
  }

  static async connect(options: AppServerConnectionOptions = {}): Promise<AppServerRuntime> {
    return new AppServerRuntime(await AppServerConnection.connect(options))
  }

  async startThread(input: StartCodexThreadInput, options?: RequestOptions): Promise<CodexThreadHandle> {
    const params: ThreadStartParams = {
      cwd: input.cwd,
      sandbox: input.sandbox,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      ephemeral: false,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.developerInstructions === undefined ? {} : { developerInstructions: input.developerInstructions }),
    }
    const response = await this.transport.request("thread/start", params, options) as { thread: { id: string } }
    return { threadId: response.thread.id }
  }

  async resumeThread(threadId: string, input: StartCodexThreadInput, options?: RequestOptions): Promise<CodexThreadHandle> {
    const params: ThreadResumeParams = {
      threadId,
      cwd: input.cwd,
      sandbox: input.sandbox,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.developerInstructions === undefined ? {} : { developerInstructions: input.developerInstructions }),
    }
    const response = await this.transport.request("thread/resume", params, options) as { thread: { id: string } }
    return { threadId: response.thread.id }
  }

  async startTurn(threadId: string, prompt: string, options?: RequestOptions): Promise<CodexTurnHandle> {
    const params: TurnStartParams = { threadId, input: [{ type: "text", text: prompt, text_elements: [] }] }
    const response = await this.transport.request("turn/start", params, options) as { turn: { id: string } }
    return { turnId: response.turn.id }
  }

  async steerTurn(threadId: string, turnId: string, prompt: string, options?: RequestOptions): Promise<CodexTurnHandle> {
    const params: TurnSteerParams = { threadId, expectedTurnId: turnId, input: [{ type: "text", text: prompt, text_elements: [] }] }
    const response = await this.transport.request("turn/steer", params, options) as { turnId: string }
    return { turnId: response.turnId }
  }

  async interruptTurn(threadId: string, turnId: string, options?: RequestOptions): Promise<void> {
    await this.transport.request("turn/interrupt", { threadId, turnId }, options)
  }

  async resolveApproval(requestId: RequestId, decision: "approve" | "deny", answers?: Record<string, string[]>): Promise<void> {
    const approval = this.approvals.get(requestId)
    if (!approval) throw new Error(`Unknown or resolved Codex approval request: ${String(requestId)}`)
    this.approvals.delete(requestId)
    if (approval.kind === "user_input") {
      if (decision === "deny") {
        await this.transport.rejectServerRequest(requestId, -32001, "User denied input request")
      } else {
        const response: ToolRequestUserInputResponse = {
          answers: Object.fromEntries(Object.entries(answers ?? {}).map(([id, values]) => [id, { answers: values }])),
        }
        await this.transport.respond(requestId, response)
      }
      return
    }
    if (approval.kind === "permissions") {
      if (decision === "deny") {
        await this.transport.respond(requestId, { permissions: {}, scope: "turn" })
      } else {
        const requested = approval.params.permissions && typeof approval.params.permissions === "object"
          ? approval.params.permissions as Record<string, unknown>
          : {}
        await this.transport.respond(requestId, {
          permissions: {
            ...(requested.network ? { network: requested.network } : {}),
            ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {}),
          },
          scope: "turn",
        })
      }
      return
    }
    if (approval.method === "applyPatchApproval" || approval.method === "execCommandApproval") {
      await this.transport.respond(requestId, { decision: decision === "approve" ? "approved" : "denied" })
      return
    }
    await this.transport.respond(requestId, { decision: decision === "approve" ? "accept" : "decline" })
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): Promise<void> {
    return this.transport.close()
  }

  private handleNotification(notification: ServerNotification): void {
    switch (notification.method) {
      case "thread/started":
        this.emit({ kind: "thread.started", threadId: notification.params.thread.id })
        break
      case "turn/started":
        this.emit({ kind: "turn.started", threadId: notification.params.threadId, turnId: notification.params.turn.id })
        break
      case "turn/completed": {
        const { threadId, turn } = notification.params
        const status = turn.status === "inProgress" ? "failed" : turn.status
        this.emit({
          kind: "turn.completed",
          threadId,
          turnId: turn.id,
          status,
          ...(turn.error ? { error: turn.error.message } : {}),
        })
        break
      }
      case "item/started": {
        const summary = summarizeToolItem(notification.params.item)
        if (summary) {
          this.emit({
            kind: "tool.started",
            threadId: notification.params.threadId,
            turnId: notification.params.turnId,
            itemId: notification.params.item.id,
            tool: summary.tool,
            inputSummary: summary.inputSummary,
          })
        }
        break
      }
      case "item/completed": {
        const summary = summarizeToolItem(notification.params.item)
        if (summary) {
          this.emit({
            kind: "tool.completed",
            threadId: notification.params.threadId,
            turnId: notification.params.turnId,
            itemId: notification.params.item.id,
            tool: summary.tool,
            status: completedToolStatus(notification.params.item),
            inputSummary: summary.inputSummary,
            outputSummary: summary.outputSummary,
          })
        }
        break
      }
      case "item/agentMessage/delta":
        this.emit({ kind: "output.delta", threadId: notification.params.threadId, turnId: notification.params.turnId, text: notification.params.delta })
        break
      case "error":
        if (!notification.params.willRetry) {
          this.emit({ kind: "runtime.error", threadId: notification.params.threadId, turnId: notification.params.turnId, message: notification.params.error.message })
        }
        break
    }
  }

  private handleServerRequest(request: ServerRequest): void {
    const params = request.params as Record<string, unknown>
    const common = {
      requestId: request.id,
      threadId: String(params.threadId ?? params.conversationId ?? ""),
      turnId: String(params.turnId ?? ""),
      itemId: String(params.itemId ?? ""),
    }
    let event: Extract<CodexRuntimeEvent, { kind: "approval.requested" }> | null = null
    if (request.method === "item/commandExecution/requestApproval" || request.method === "execCommandApproval") {
      event = { kind: "approval.requested", approvalKind: "command", ...common, ...(typeof params.reason === "string" ? { reason: params.reason } : {}), ...(typeof params.command === "string" ? { command: params.command } : {}) }
    } else if (request.method === "item/fileChange/requestApproval" || request.method === "applyPatchApproval") {
      event = { kind: "approval.requested", approvalKind: "file_change", ...common, ...(typeof params.reason === "string" ? { reason: params.reason } : {}) }
    } else if (request.method === "item/permissions/requestApproval") {
      event = { kind: "approval.requested", approvalKind: "permissions", ...common, ...(typeof params.reason === "string" ? { reason: params.reason } : {}) }
    } else if (request.method === "item/tool/requestUserInput") {
      event = { kind: "approval.requested", approvalKind: "user_input", ...common, questions: Array.isArray(params.questions) ? params.questions : [] }
    }
    if (!event) {
      void this.transport.rejectServerRequest(request.id, -32601, `Unsupported server request: ${request.method}`)
      return
    }
    this.approvals.set(request.id, { kind: event.approvalKind, method: request.method, params })
    this.emit(event)
  }

  private emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

interface ToolItemSummary {
  tool: CodexToolKind
  inputSummary: string
  outputSummary: string
}

function summarizeToolItem(item: ThreadItem): ToolItemSummary | null {
  switch (item.type) {
    case "commandExecution":
      return {
        tool: "command",
        inputSummary: `Command content withheld (${item.command.length} characters).`,
        outputSummary: item.aggregatedOutput === null
          ? `Process output unavailable; exit code ${safeExitCode(item.exitCode)}.`
          : `Process output withheld (${item.aggregatedOutput.length} characters); exit code ${safeExitCode(item.exitCode)}.`,
      }
    case "fileChange":
      return {
        tool: "file_change",
        inputSummary: `File change content withheld (${item.changes.length} changes).`,
        outputSummary: `File change result content withheld (${item.changes.length} changes).`,
      }
    case "mcpToolCall":
      return {
        tool: "mcp",
        inputSummary: "MCP arguments withheld.",
        outputSummary: item.result === null
          ? "MCP result content unavailable."
          : "MCP result content withheld.",
      }
    case "dynamicToolCall":
      return {
        tool: "dynamic",
        inputSummary: "Dynamic tool arguments withheld.",
        outputSummary: item.contentItems === null
          ? "Dynamic tool result content unavailable."
          : `Dynamic tool result content withheld (${item.contentItems.length} items).`,
      }
    case "collabAgentToolCall":
      return {
        tool: "collaboration",
        inputSummary: item.prompt === null
          ? "Collaboration prompt unavailable."
          : `Collaboration prompt withheld (${item.prompt.length} characters).`,
        outputSummary: "Collaboration result details withheld.",
      }
    case "webSearch":
      return {
        tool: "web_search",
        inputSummary: `Search query withheld (${item.query.length} characters).`,
        outputSummary: "Search result details unavailable in item lifecycle.",
      }
    case "imageView":
      return {
        tool: "image_view",
        inputSummary: "Image path withheld.",
        outputSummary: "Image content unavailable in item lifecycle.",
      }
    case "sleep":
      return {
        tool: "sleep",
        inputSummary: `Sleep duration ${safeDuration(item.durationMs)} ms.`,
        outputSummary: "Sleep completed.",
      }
    case "imageGeneration":
      return {
        tool: "image_generation",
        inputSummary: "Image generation prompt unavailable in item lifecycle.",
        outputSummary: item.result.length === 0
          ? "Generated image content unavailable."
          : `Generated image content withheld (${item.result.length} characters).`,
      }
    case "userMessage":
    case "hookPrompt":
    case "agentMessage":
    case "plan":
    case "reasoning":
    case "subAgentActivity":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      return null
    default:
      return assertNever(item)
  }
}

function completedToolStatus(item: ThreadItem): "completed" | "failed" {
  switch (item.type) {
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "collabAgentToolCall":
      return item.status === "completed" ? "completed" : "failed"
    case "imageGeneration":
      return item.status === "completed" ? "completed" : "failed"
    case "webSearch":
    case "imageView":
    case "sleep":
      return "completed"
    case "userMessage":
    case "hookPrompt":
    case "agentMessage":
    case "plan":
    case "reasoning":
    case "subAgentActivity":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      throw new Error(`Non-tool Codex item has no tool completion status: ${item.type}`)
    default:
      return assertNever(item)
  }
}

function assertNever(_value: never): never {
  throw new Error("Unsupported Codex ThreadItem variant")
}

function safeExitCode(value: number | null): string {
  return Number.isSafeInteger(value) ? String(value) : "unavailable"
}

function safeDuration(value: number): string {
  return Number.isSafeInteger(value) && value >= 0 && value <= 300_000
    ? String(value)
    : "unavailable"
}
