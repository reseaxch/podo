import { AppServerRuntime, type CodexRuntime, type CodexRuntimeEvent } from "@podo/codex-app-server-client"
import type {
  ApprovalDecisionRequest,
  ApprovalDecisionResponse,
  CancelInvestigationResponse,
  GetInvestigationResponse,
  Investigation,
  InvestigationApproval,
  InvestigationEvent,
  StartInvestigationRequest,
  StartInvestigationResponse,
} from "@podo/contracts"

interface InternalApproval {
  public: InvestigationApproval
  runtimeRequestId: string | number
}

interface InternalInvestigation {
  public: Investigation
  prompt: string
  runtime?: CodexRuntime
  threadId?: string
  turnId?: string
  turnStarting?: boolean
  interruptTurnWhenStarted?: boolean
  turnTimeout?: unknown
  bufferedTurnEvents: CodexRuntimeEvent[]
  events: InvestigationEvent[]
  outputDeltas: string[]
  approval?: InternalApproval
  listeners: Set<(event: InvestigationEvent) => void>
  approvalPolicy: "interactive" | "deny_all"
  onEvent?: (event: InvestigationEvent) => void
  onApprovalDenied?: (investigationId: string, approvalKind: InvestigationApproval["kind"]) => void
}

export interface InvestigationServiceOptions {
  runtime?: CodexRuntime
  createRuntime?: () => Promise<CodexRuntime>
  eventLogLimit?: number
  timer?: InvestigationTimer
}

export interface InvestigationTimer {
  schedule(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export interface InvestigationStartOptions {
  approvalPolicy?: "interactive" | "deny_all"
  developerInstructions?: string
  turnTimeoutMs?: number
  onEvent?: (event: InvestigationEvent) => void
  onApprovalDenied?: (investigationId: string, approvalKind: InvestigationApproval["kind"]) => void
}

export class InvestigationService {
  private readonly investigations = new Map<string, InternalInvestigation>()
  private readonly byThread = new Map<string, string>()
  private readonly eventLogLimit: number
  private runtimePromise: Promise<CodexRuntime> | null = null
  private currentRuntime: CodexRuntime | null = null
  private runtimeUnsubscribe: (() => void) | null = null
  private runtimeErrorMessage: string | null = null
  private readonly timer: InvestigationTimer

  constructor(private readonly options: InvestigationServiceOptions = {}) {
    this.eventLogLimit = Math.max(1, options.eventLogLimit ?? 256)
    this.timer = options.timer ?? systemInvestigationTimer
    if (typeof this.timer.schedule !== "function" || typeof this.timer.clear !== "function") {
      throw new Error("invalid_investigation_timer")
    }
    if (options.runtime) {
      this.runtimePromise = Promise.resolve(options.runtime)
      this.bindRuntime(options.runtime)
    }
  }

  get runtimeError(): string | null {
    return this.runtimeErrorMessage
  }

  acquireRuntime(): Promise<CodexRuntime> {
    return this.getRuntime()
  }

  async start(
    input: StartInvestigationRequest,
    options: InvestigationStartOptions = {},
  ): Promise<StartInvestigationResponse> {
    const turnTimeoutMs = validateTurnTimeout(options.turnTimeoutMs)
    const now = new Date().toISOString()
    const investigation: InternalInvestigation = {
      public: {
        id: crypto.randomUUID(),
        status: "starting",
        cwd: input.cwd,
        sandbox: input.sandbox,
        createdAt: now,
        updatedAt: now,
        lastSequence: 0,
        pendingApproval: null,
      },
      prompt: input.prompt,
      bufferedTurnEvents: [],
      events: [],
      outputDeltas: [],
      listeners: new Set(),
      approvalPolicy: options.approvalPolicy ?? "interactive",
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      ...(options.onApprovalDenied ? { onApprovalDenied: options.onApprovalDenied } : {}),
    }
    this.investigations.set(investigation.public.id, investigation)
    this.append(investigation, { kind: "investigation.started", payload: { status: "starting" } })
    try {
      const runtime = await this.getRuntime()
      investigation.runtime = runtime
      const thread = await runtime.startThread({
        cwd: input.cwd,
        sandbox: input.sandbox,
        ...(options.developerInstructions === undefined
          ? {}
          : { developerInstructions: options.developerInstructions }),
      })
      investigation.threadId = thread.threadId
      this.byThread.set(thread.threadId, investigation.public.id)
      investigation.turnStarting = true
      const turn = await runtime.startTurn(thread.threadId, input.prompt)
      investigation.turnId = turn.turnId
      delete investigation.turnStarting
      if (investigation.interruptTurnWhenStarted) {
        delete investigation.interruptTurnWhenStarted
        try { void runtime.interruptTurn(thread.threadId, turn.turnId).catch(() => undefined) } catch {}
      }
      const bufferedTurnEvents = investigation.bufferedTurnEvents.splice(0)
      for (const event of bufferedTurnEvents) this.handleRuntimeEvent(event)
      if (investigation.public.status === "starting") {
        investigation.public.status = "running"
        this.append(investigation, { kind: "investigation.running", payload: { status: "running" } })
      }
      if (!isTerminal(investigation.public.status) && turnTimeoutMs !== undefined) {
        this.armTurnTimeout(investigation, turnTimeoutMs)
      }
    } catch (error) {
      delete investigation.turnStarting
      investigation.bufferedTurnEvents.length = 0
      this.fail(investigation, errorMessage(error))
    }
    return { investigation: snapshot(investigation.public) }
  }

  get(id: string): GetInvestigationResponse | null {
    const investigation = this.investigations.get(id)
    return investigation ? { investigation: snapshot(investigation.public) } : null
  }

  getCompletedOutput(id: string): string | null {
    const investigation = this.investigations.get(id)
    return investigation?.public.status === "completed"
      ? investigation.outputDeltas.join("")
      : null
  }

  async cancel(id: string): Promise<CancelInvestigationResponse | null> {
    const investigation = this.investigations.get(id)
    if (!investigation) return null
    if (isTerminal(investigation.public.status)) return { investigation: snapshot(investigation.public) }
    this.clearTurnTimeout(investigation)
    try {
      const runtime = investigation.runtime ?? await this.getRuntime()
      if (investigation.approval?.public.status === "pending") {
        await runtime.resolveApproval(investigation.approval.runtimeRequestId, "deny")
        investigation.approval.public.status = "denied"
      }
      if (investigation.threadId && investigation.turnId) {
        await runtime.interruptTurn(investigation.threadId, investigation.turnId)
      }
      if (!isTerminal(investigation.public.status)) {
        investigation.public.status = "cancelled"
        investigation.outputDeltas.length = 0
        delete investigation.approval
        investigation.public.pendingApproval = null
        this.append(investigation, { kind: "investigation.cancelled", payload: { status: "cancelled" } })
      }
    } catch (error) {
      this.fail(investigation, errorMessage(error))
    }
    return { investigation: snapshot(investigation.public) }
  }

  async decideApproval(id: string, approvalId: string, input: ApprovalDecisionRequest): Promise<ApprovalDecisionResponse | null> {
    const investigation = this.investigations.get(id)
    const approval = investigation?.approval
    if (!investigation || isTerminal(investigation.public.status) || !approval || approval.public.id !== approvalId || approval.public.status !== "pending") return null
    try {
      const runtime = await this.getRuntime()
      await runtime.resolveApproval(approval.runtimeRequestId, input.decision, input.answers)
      approval.public.status = input.decision === "approve" ? "approved" : "denied"
      investigation.public.pendingApproval = null
      if (!isTerminal(investigation.public.status)) investigation.public.status = "running"
      this.append(investigation, { kind: "approval.resolved", payload: { approval: { ...approval.public } } })
      delete investigation.approval
      return { investigation: snapshot(investigation.public), approval: { ...approval.public } }
    } catch (error) {
      this.fail(investigation, errorMessage(error))
      throw error
    }
  }

  replay(id: string, afterSequence: number): InvestigationEvent[] | null {
    const investigation = this.investigations.get(id)
    if (!investigation) return null
    return investigation.events.filter((event) => event.sequence > afterSequence)
  }

  earliestSequence(id: string): number | null {
    const events = this.investigations.get(id)?.events
    return events?.[0]?.sequence ?? null
  }

  isTerminal(id: string): boolean {
    const status = this.investigations.get(id)?.public.status
    return status ? isTerminal(status) : false
  }

  subscribe(id: string, listener: (event: InvestigationEvent) => void): (() => void) | null {
    const investigation = this.investigations.get(id)
    if (!investigation) return null
    investigation.listeners.add(listener)
    return () => investigation.listeners.delete(listener)
  }

  private async getRuntime(): Promise<CodexRuntime> {
    const promise = this.runtimePromise ?? (this.options.createRuntime ?? (() => AppServerRuntime.connect()))()
    this.runtimePromise = promise
    try {
      const runtime = await promise
      if (this.currentRuntime !== runtime) this.bindRuntime(runtime)
      this.runtimeErrorMessage = null
      return runtime
    } catch (error) {
      if (this.runtimePromise === promise) this.runtimePromise = null
      this.runtimeErrorMessage = errorMessage(error)
      throw error
    }
  }

  private handleRuntimeEvent(event: CodexRuntimeEvent): void {
    if (event.kind === "runtime.error" && !event.threadId) {
      this.runtimeErrorMessage = event.message
      this.runtimePromise = null
      this.currentRuntime = null
      this.runtimeUnsubscribe?.()
      this.runtimeUnsubscribe = null
      for (const investigation of this.investigations.values()) {
        if (!isTerminal(investigation.public.status)) this.fail(investigation, event.message)
      }
      return
    }
    if (!("threadId" in event)) return
    const id = this.byThread.get(event.threadId)
    const investigation = id ? this.investigations.get(id) : undefined
    if (!investigation) return
    if (investigation.turnStarting && isTurnEvent(event) && !isTerminal(investigation.public.status)) {
      if (investigation.bufferedTurnEvents.length >= this.eventLogLimit) {
        investigation.bufferedTurnEvents.length = 0
        investigation.interruptTurnWhenStarted = true
        this.fail(investigation, "Investigation turn event buffer exceeded configured limit")
        return
      }
      investigation.bufferedTurnEvents.push(structuredClone(event))
      return
    }
    if (isTerminal(investigation.public.status)) {
      if (event.kind === "approval.requested" && investigation.approvalPolicy === "deny_all") {
        this.denyRuntimeApproval(investigation, event.requestId)
      }
      return
    }
    switch (event.kind) {
      case "output.delta":
        if (event.turnId !== investigation.turnId) return
        investigation.outputDeltas.push(event.text)
        this.append(investigation, { kind: "output.delta", payload: { text: event.text } })
        break
      case "approval.requested": {
        if (event.turnId !== investigation.turnId) return
        if (investigation.approvalPolicy === "deny_all") {
          investigation.onApprovalDenied?.(investigation.public.id, event.approvalKind)
          this.denyRuntimeApproval(investigation, event.requestId)
          this.fail(investigation, `Investigator requested forbidden ${event.approvalKind} approval`)
          return
        }
        if (investigation.approval?.public.status === "pending") {
          void this.getRuntime().then((runtime) => runtime.resolveApproval(event.requestId, "deny")).catch(() => undefined)
          return
        }
        const approval: InvestigationApproval = {
          id: crypto.randomUUID(),
          kind: event.approvalKind,
          status: "pending",
          ...(event.reason ? { reason: event.reason } : {}),
          ...(event.command ? { command: event.command } : {}),
          ...(event.questions ? { questions: sanitizeQuestions(event.questions) } : {}),
        }
        investigation.approval = { public: approval, runtimeRequestId: event.requestId }
        investigation.public.pendingApproval = approval
        investigation.public.status = "waiting_for_approval"
        this.append(investigation, { kind: "approval.requested", payload: { approval: { ...approval } } })
        break
      }
      case "turn.completed":
        if (event.turnId !== investigation.turnId) return
        if (investigation.approval?.public.status === "pending") {
          const requestId = investigation.approval.runtimeRequestId
          void this.getRuntime().then((runtime) => runtime.resolveApproval(requestId, "deny")).catch(() => undefined)
          investigation.public.pendingApproval = null
          delete investigation.approval
        }
        if (event.status === "completed") {
          this.clearTurnTimeout(investigation)
          investigation.public.status = "completed"
          this.append(investigation, { kind: "investigation.completed", payload: { status: "completed" } })
        } else if (event.status === "interrupted") {
          this.clearTurnTimeout(investigation)
          investigation.public.status = "cancelled"
          this.append(investigation, { kind: "investigation.cancelled", payload: { status: "cancelled" } })
        } else {
          this.fail(investigation, event.error ?? "Codex turn failed")
        }
        break
      case "runtime.error":
        this.fail(investigation, event.message)
        break
    }
  }

  private bindRuntime(runtime: CodexRuntime): void {
    this.runtimeUnsubscribe?.()
    this.currentRuntime = runtime
    this.runtimeUnsubscribe = runtime.onEvent((event) => {
      if (this.currentRuntime === runtime) this.handleRuntimeEvent(event)
    })
  }

  private denyRuntimeApproval(investigation: InternalInvestigation, requestId: string | number): void {
    const stop = async (runtime: CodexRuntime) => {
      await runtime.resolveApproval(requestId, "deny")
      if (investigation.threadId && investigation.turnId) {
        await runtime.interruptTurn(investigation.threadId, investigation.turnId)
      }
    }
    const resolution = this.currentRuntime ? stop(this.currentRuntime) : this.getRuntime().then(stop)
    void resolution.catch(() => undefined)
  }

  private append(investigation: InternalInvestigation, data: Omit<InvestigationEvent, "investigationId" | "sequence" | "timestamp">): void {
    const event = {
      investigationId: investigation.public.id,
      sequence: investigation.public.lastSequence + 1,
      timestamp: new Date().toISOString(),
      ...data,
    } as InvestigationEvent
    investigation.public.lastSequence = event.sequence
    investigation.public.updatedAt = event.timestamp
    investigation.events.push(event)
    if (investigation.events.length > this.eventLogLimit) investigation.events.splice(0, investigation.events.length - this.eventLogLimit)
    for (const listener of investigation.listeners) listener(event)
    investigation.onEvent?.(structuredClone(event))
  }

  private fail(investigation: InternalInvestigation, message: string): void {
    if (isTerminal(investigation.public.status)) return
    this.clearTurnTimeout(investigation)
    investigation.public.status = "failed"
    investigation.outputDeltas.length = 0
    investigation.public.error = message
    investigation.public.pendingApproval = null
    delete investigation.approval
    this.append(investigation, { kind: "investigation.failed", payload: { status: "failed", error: message } })
  }

  private armTurnTimeout(investigation: InternalInvestigation, turnTimeoutMs: number): void {
    this.clearTurnTimeout(investigation)
    investigation.turnTimeout = this.timer.schedule(() => {
      if (isTerminal(investigation.public.status)) return
      const runtime = investigation.runtime
      const threadId = investigation.threadId
      const turnId = investigation.turnId
      const pendingApprovalRequestId = investigation.approval?.runtimeRequestId
      this.fail(investigation, "Investigation exceeded the configured turn timeout")
      if (runtime && threadId && turnId) {
        if (pendingApprovalRequestId !== undefined) {
          try { void runtime.resolveApproval(pendingApprovalRequestId, "deny").catch(() => undefined) } catch {}
        }
        try { void runtime.interruptTurn(threadId, turnId).catch(() => undefined) } catch {}
      }
    }, turnTimeoutMs)
  }

  private clearTurnTimeout(investigation: InternalInvestigation): void {
    if (investigation.turnTimeout === undefined) return
    const handle = investigation.turnTimeout
    delete investigation.turnTimeout
    this.timer.clear(handle)
  }
}

const systemInvestigationTimer: InvestigationTimer = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs)
    handle.unref()
    return handle
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

function validateTurnTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 3_600_000) {
    throw new Error("invalid_investigation_turn_timeout")
  }
  return value
}

function snapshot(investigation: Investigation): Investigation {
  return structuredClone(investigation)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTerminal(status: Investigation["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed"
}

function isTurnEvent(event: CodexRuntimeEvent): event is Extract<CodexRuntimeEvent, {
  kind: "output.delta" | "approval.requested" | "turn.completed"
}> {
  return event.kind === "output.delta" || event.kind === "approval.requested" || event.kind === "turn.completed"
}

function sanitizeQuestions(value: unknown[]): NonNullable<InvestigationApproval["questions"]> {
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const question = entry as Record<string, unknown>
    if (typeof question.id !== "string" || typeof question.header !== "string" || typeof question.question !== "string") return []
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) => option && typeof option === "object" && typeof (option as Record<string, unknown>).label === "string"
        ? [{ label: String((option as Record<string, unknown>).label), description: String((option as Record<string, unknown>).description ?? "") }]
        : [])
      : null
    return [{ id: question.id, header: question.header, question: question.question, options }]
  })
}
