"use client"

import type {
  AgentChatAnswer,
  AgentChatEvent,
  CreateAgentChatResponse,
} from "@podo/contracts"
import Link from "next/link"
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"

import { isAgentChatTransportFailure } from "../../lib/agent-chat-transport"
import { incidentWorkspaceHref } from "../../lib/incident-links"
import { Icon } from "../ui/pictogram"

type StructuredAgentAnswer = AgentChatAnswer

type ChatMessage = {
  durationMs?: number
  id: string
  role: "user" | "assistant"
  structured?: StructuredAgentAnswer
  text: string
  state?: "thinking" | "streaming" | "complete" | "stopped" | "failed"
}

type AgentPanelProps = {
  mode?: "demo" | "live"
  onClose: () => void
  projectLabel: string
  projectScope: string
}

const suggestions = [
  "Summarize what needs attention",
  "Trace the strongest evidence",
  "What should I review next?",
]

const thinkingSteps = [
  {
    label: "Mapping project scope",
    detail: "Incidents, services, deployments, and code",
  },
  {
    label: "Gathering live evidence",
    detail: "Metrics, traces, logs, and recent changes",
  },
  {
    label: "Correlating causal paths",
    detail: "Service → deployment → commit → code",
  },
  {
    label: "Drafting evidence summary",
    detail: "Findings, confidence, and next step",
  },
]

const agentHistoryVersion = 2
const configuredAgentMode =
  process.env.NEXT_PUBLIC_PODO_AGENT_MODE === "live" ? "live" : "demo"

let messageSequence = 0

function messageId(role: ChatMessage["role"]): string {
  messageSequence += 1
  return `${role}-${Date.now()}-${messageSequence}`
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs < 100) return "<0.1s"
  return `${(durationMs / 1_000).toFixed(1)}s`
}

function evidenceHref(item: string, incidentId?: string): string {
  if (!incidentId) return "/evidence-sources"
  const normalized = item.toLowerCase()
  const tab = normalized.includes("system graph")
    ? "graph"
    : /\bcommit\b|\bcode\b|\brepository\b|^deploy\b/.test(normalized)
      ? "changes"
      : "evidence"
  return incidentWorkspaceHref({ anchor: false, incidentId, tab })
}

function isStructuredAnswer(value: unknown): value is StructuredAgentAnswer {
  if (!value || typeof value !== "object") return false
  const answer = value as Partial<StructuredAgentAnswer>
  return (
    answer.schemaVersion === "podo.agent-answer.v1" &&
    typeof answer.finding === "string" &&
    typeof answer.recommendation === "string" &&
    answer.safety === "No changes were made." &&
    Array.isArray(answer.causalPath) &&
    answer.causalPath.every((item) => typeof item === "string") &&
    Array.isArray(answer.evidence) &&
    answer.evidence.every((item) => typeof item === "string") &&
    (answer.confidencePercent === undefined ||
      (Number.isInteger(answer.confidencePercent) &&
        answer.confidencePercent >= 0 &&
        answer.confidencePercent <= 100)) &&
    (answer.incidentId === undefined || /^INC-\d{1,9}$/.test(answer.incidentId))
  )
}

function restoreHistory(value: string | null): ChatMessage[] {
  if (!value) return []
  try {
    const stored = JSON.parse(value) as {
      messages?: unknown
      version?: unknown
    }
    if (
      stored.version !== agentHistoryVersion ||
      !Array.isArray(stored.messages)
    )
      return []
    return stored.messages.flatMap((value): ChatMessage[] => {
      if (!value || typeof value !== "object") return []
      const message = value as Partial<ChatMessage>
      if (
        typeof message.id !== "string" ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.text !== "string" ||
        message.state === "thinking" ||
        message.state === "streaming"
      )
        return []
      return [
        {
          id: message.id,
          role: message.role,
          text: message.text,
          state: message.state ?? "complete",
          ...(typeof message.durationMs === "number"
            ? { durationMs: message.durationMs }
            : {}),
          ...(isStructuredAnswer(message.structured)
            ? { structured: message.structured }
            : {}),
        },
      ]
    })
  } catch {
    return []
  }
}

function completedHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message, index) => {
    if (message.state === "thinking" || message.state === "streaming")
      return false
    if (message.role !== "user") return true
    const response = messages[index + 1]
    return Boolean(
      response?.role === "assistant" &&
      response.state !== "thinking" &&
      response.state !== "streaming",
    )
  })
}

function parseStructuredAnswer(text: string): StructuredAgentAnswer | null {
  const normalizedText = text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(
      /\*\*(The likely causal chain is:|Evidence checked:|Recommended next step:)\*\*/g,
      "$1",
    )
  const causalMarker = "The likely causal chain is:"
  const evidenceMarker = "Evidence checked:"
  const recommendationMarker = "Recommended next step:"
  const causalIndex = normalizedText.indexOf(causalMarker)
  const evidenceIndex = normalizedText.indexOf(evidenceMarker)
  const recommendationIndex = normalizedText.indexOf(recommendationMarker)
  if (
    causalIndex < 0 ||
    evidenceIndex < causalIndex ||
    recommendationIndex < evidenceIndex
  )
    return null

  const finding = normalizedText.slice(0, causalIndex).trim()
  const causalPath = normalizedText
    .slice(causalIndex + causalMarker.length, evidenceIndex)
    .trim()
    .split(/\s*(?:->|→)\s*/)
    .filter(Boolean)
  const evidence = normalizedText
    .slice(evidenceIndex + evidenceMarker.length, recommendationIndex)
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter(Boolean)
  const rawRecommendation = normalizedText
    .slice(recommendationIndex + recommendationMarker.length)
    .trim()
  const recommendation = rawRecommendation
    .replace(/No changes were made\.?/i, "")
    .trim()
  const incidentId = normalizedText.match(/\bINC-\d+\b/)?.[0]
  const confidence = normalizedText.match(/\b(\d+)% confidence\b/i)?.[1]

  if (!finding || causalPath.length < 2 || evidence.length === 0) return null
  return {
    schemaVersion: "podo.agent-answer.v1",
    causalPath,
    evidence,
    finding,
    recommendation,
    safety: "No changes were made.",
    ...(confidence ? { confidencePercent: Number(confidence) } : {}),
    ...(incidentId ? { incidentId } : {}),
  }
}

function demoAnswerFor(
  prompt: string,
  projectLabel: string,
): StructuredAgentAnswer {
  const normalizedPrompt = prompt.toLowerCase()
  const base = {
    schemaVersion: "podo.agent-answer.v1" as const,
    causalPath: [
      "checkout-service heap pressure",
      "deploy v1.8.4",
      "commit 8f3a2c1",
      "session-cache.ts:47",
    ],
    confidencePercent: 96,
    evidence: [
      "Memory reached 91% after the latest deployment.",
      "Error rate rose to 8.7% while p95 latency reached 1.82s.",
      "The system graph links the regression to unbounded cache retention with 96% confidence.",
    ],
    incidentId: "INC-042",
    safety: "No changes were made." as const,
  }

  if (normalizedPrompt.includes("review next"))
    return {
      ...base,
      finding: `The highest-value next review in ${projectLabel} is the checkout-service regression linked to INC-042.`,
      recommendation:
        "Open INC-042 and compare the cited traces with deploy v1.8.4 before approving a bounded cache remediation.",
    }
  if (normalizedPrompt.includes("summarize"))
    return {
      ...base,
      finding: `The strongest active risk in ${projectLabel} is checkout-service heap pressure introduced after the latest deployment.`,
      recommendation:
        "Open INC-042 and review the correlated memory, error-rate, and latency evidence before deciding on remediation.",
    }
  return {
    ...base,
    finding: `The strongest evidence in ${projectLabel} points from the latest deployment to unbounded session-cache retention.`,
    recommendation:
      "Open INC-042 and review the cited traces before approving a bounded cache remediation.",
  }
}

function formatStructuredAnswer(answer: StructuredAgentAnswer): string {
  return [
    answer.finding,
    "The likely causal chain is:",
    answer.causalPath.join(" -> "),
    "Evidence checked:",
    ...answer.evidence.map((item) => `- ${item}`),
    "Recommended next step:",
    `${answer.recommendation} ${answer.safety}`,
  ].join("\n")
}

function waitForDemoStep(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = window.setTimeout(resolve, delayMs)
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })
}

async function readAgentEvents(
  response: Response,
  onEvent: (event: AgentChatEvent) => void,
) {
  if (!response.body) throw new Error("Agent stream unavailable")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    buffer = buffer.replaceAll("\r\n", "\n")
    let boundary = buffer.indexOf("\n\n")
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (data) {
        const parsed = JSON.parse(data) as unknown
        if (isAgentChatTransportFailure(parsed))
          throw new Error(parsed.error.message)
        onEvent(parsed as AgentChatEvent)
      }
      boundary = buffer.indexOf("\n\n")
    }
    if (done) break
  }
}

function ThinkingState({
  projectLabel,
  stage,
}: {
  projectLabel: string
  stage: number
}) {
  return (
    <div className="agent-thinking" aria-live="polite" role="status">
      <header>
        <span className="agent-thinking-mark">
          <Icon name="robot" size={16} />
        </span>
        <div>
          <strong>Investigating {projectLabel}</strong>
          <small>Project-wide evidence scan</small>
        </div>
        <span className="agent-thinking-counter">
          <strong key={stage}>{stage + 1}</strong> of {thinkingSteps.length}
        </span>
      </header>
      <div aria-hidden="true" className="agent-thinking-progress">
        {thinkingSteps.map((step, index) => (
          <span
            data-state={
              index < stage
                ? "complete"
                : index === stage
                  ? "active"
                  : "pending"
            }
            key={step.label}
          />
        ))}
      </div>
      <div className="agent-thinking-steps">
        {thinkingSteps.map((step, index) => {
          const state =
            index < stage ? "complete" : index === stage ? "active" : "pending"
          return (
            <span data-state={state} key={step.label}>
              <i>
                <Icon
                  name={
                    state === "complete"
                      ? "check-circle"
                      : state === "active"
                        ? "activity"
                        : "clock"
                  }
                  size={13}
                />
              </i>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              <em>
                {state === "complete"
                  ? "Complete"
                  : state === "active"
                    ? "In progress"
                    : "Queued"}
              </em>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function AgentAnswer({
  answer,
  collapsed,
  copied,
  durationMs,
  onCopy,
  onRetry,
  onToggle,
  retrying,
}: {
  answer: StructuredAgentAnswer
  collapsed: boolean
  copied: boolean
  durationMs?: number
  onCopy: () => void
  onRetry: () => void
  onToggle: () => void
  retrying: boolean
}) {
  const resultMeta = (
    <div className="agent-answer-meta">
      <span>{answer.evidence.length} sources checked</span>
      <i aria-hidden="true" />
      <span>{formatDuration(durationMs)}</span>
      <i aria-hidden="true" />
      <span>Read-only</span>
    </div>
  )

  return (
    <section
      aria-label="Investigation result"
      className="agent-answer"
      data-collapsed={collapsed}
    >
      <header className="agent-answer-finding">
        <div>
          <span>Finding</span>
          <strong>{answer.finding}</strong>
        </div>
        <div className="agent-answer-heading-actions">
          {answer.confidencePercent !== undefined ? (
            <em>{answer.confidencePercent}% confidence</em>
          ) : null}
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand answer" : "Collapse answer"}
            onClick={onToggle}
            type="button"
          >
            <Icon name={collapsed ? "caret-down" : "caret-up"} size={13} />
          </button>
        </div>
      </header>

      {collapsed ? (
        resultMeta
      ) : (
        <div className="agent-answer-details">
          <section className="agent-answer-path">
            <span>Causal path</span>
            <div>
              {answer.causalPath.map((item, index) => (
                <span key={`${item}-${index}`}>
                  <code>{item}</code>
                  {index < answer.causalPath.length - 1 ? (
                    <Icon name="caret-right" size={11} />
                  ) : null}
                </span>
              ))}
            </div>
          </section>

          <section className="agent-answer-evidence">
            <span>Evidence checked</span>
            <ul>
              {answer.evidence.map((item) => (
                <li key={item}>
                  <Link
                    aria-label={`Open evidence: ${item}`}
                    href={evidenceHref(item, answer.incidentId)}
                  >
                    <Icon name="check-circle" size={13} />
                    <span>{item}</span>
                    <Icon name="arrow-square-out" size={12} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="agent-answer-next">
            <div>
              <span>Recommended next step</span>
              <p>{answer.recommendation}</p>
            </div>
            {answer.incidentId ? (
              <Link
                href={incidentWorkspaceHref({
                  anchor: false,
                  incidentId: answer.incidentId,
                  tab: "evidence",
                })}
              >
                Open {answer.incidentId}
                <Icon name="caret-right" size={13} />
              </Link>
            ) : null}
          </section>

          {resultMeta}

          <footer>
            <span>
              <Icon name="shield-check" size={13} /> {answer.safety}
            </span>
            <div>
              <button data-copied={copied} onClick={onCopy} type="button">
                <Icon name={copied ? "check-circle" : "copy"} size={13} />
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                className="agent-retry-action"
                disabled={retrying}
                onClick={onRetry}
                type="button"
              >
                <Icon name="activity" size={13} />
                {retrying ? "Retrying" : "Retry"}
              </button>
            </div>
          </footer>
        </div>
      )}
    </section>
  )
}

export function AgentPanel({
  mode = configuredAgentMode,
  onClose,
  projectLabel,
  projectScope,
}: AgentPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [draft, setDraft] = useState("")
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [thinkingStage, setThinkingStage] = useState(0)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [collapsedMessageIds, setCollapsedMessageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  )
  const [turnAnchorId, setTurnAnchorId] = useState<string | null>(null)
  const conversationRef = useRef<HTMLDivElement | null>(null)
  const turnAnchorRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const chatIdRef = useRef<string | null>(null)
  const lastSequenceRef = useRef(0)
  const copyTimerRef = useRef<number | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const historyStorageKey = `podo-agent-history-v${agentHistoryVersion}:${projectLabel}`

  const updateMessage = useCallback(
    (id: string, update: (message: ChatMessage) => ChatMessage) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id ? update(message) : message,
        ),
      )
    },
    [],
  )

  const cancelAgentTurn = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    const chatId = chatIdRef.current
    if (chatId)
      void fetch(`/api/podo/agent/chats/${encodeURIComponent(chatId)}/turn`, {
        method: "DELETE",
        keepalive: true,
      })
  }, [])

  const stopActive = useCallback(() => {
    if (!activeMessageId) return
    cancelAgentTurn()
    updateMessage(activeMessageId, (message) => ({
      ...message,
      text: message.text || "Stopped before the agent finished.",
      state: "stopped",
    }))
    setActiveMessageId(null)
  }, [activeMessageId, cancelAgentTurn, updateMessage])

  useEffect(() => {
    inputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        cancelAgentTurn()
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current)
      if (retryTimerRef.current !== null)
        window.clearTimeout(retryTimerRef.current)
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [cancelAgentTurn, onClose])

  useEffect(() => {
    const restored = restoreHistory(
      window.localStorage.getItem(historyStorageKey),
    )
    setMessages(restored)
    setTurnAnchorId(
      restored.findLast((message) => message.role === "user")?.id ?? null,
    )
    setHistoryReady(true)
  }, [historyStorageKey])

  useEffect(() => {
    if (!historyReady) return
    const history = completedHistory(messages)
    try {
      if (history.length === 0) {
        window.localStorage.removeItem(historyStorageKey)
        return
      }
      window.localStorage.setItem(
        historyStorageKey,
        JSON.stringify({ version: agentHistoryVersion, messages: history }),
      )
    } catch {
      // The chat remains available in memory when storage is unavailable.
    }
  }, [historyReady, historyStorageKey, messages])

  useEffect(() => {
    const conversation = conversationRef.current
    const anchor = turnAnchorRef.current
    if (!conversation || !anchor || !turnAnchorId) return
    const frame = window.requestAnimationFrame(() => {
      const top = Math.max(
        conversation.scrollTop +
          anchor.getBoundingClientRect().top -
          conversation.getBoundingClientRect().top -
          8,
        0,
      )
      if (typeof conversation.scrollTo === "function")
        conversation.scrollTo({ top, behavior: "smooth" })
      else conversation.scrollTop = top
    })
    return () => window.cancelAnimationFrame(frame)
  }, [turnAnchorId])

  async function sendMessage(value: string) {
    const prompt = value.trim()
    if (!prompt || activeMessageId) return

    const userMessage: ChatMessage = {
      id: messageId("user"),
      role: "user",
      text: prompt,
      state: "complete",
    }
    const assistantMessage: ChatMessage = {
      id: messageId("assistant"),
      role: "assistant",
      text: "",
      state: "thinking",
    }

    setMessages((current) => [...current, userMessage, assistantMessage])
    setDraft("")
    setActiveMessageId(assistantMessage.id)
    setThinkingStage(0)
    setTurnAnchorId(userMessage.id)

    const controller = new AbortController()
    abortRef.current = controller
    let receivedText = false
    let outputDeltaCount = 0
    const startedAt = performance.now()

    try {
      if (mode === "demo") {
        for (let stage = 1; stage < thinkingSteps.length; stage += 1) {
          await waitForDemoStep(controller.signal, 420)
          setThinkingStage(stage)
        }
        await waitForDemoStep(controller.signal, 280)
        const structured = demoAnswerFor(prompt, projectLabel)
        updateMessage(assistantMessage.id, (message) => ({
          ...message,
          durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
          structured,
          text: formatStructuredAnswer(structured),
          state: "complete",
        }))
        return
      }

      let chatId = chatIdRef.current
      if (!chatId) {
        const readiness = await fetch("/api/podo/agent/readiness", {
          signal: controller.signal,
        })
        if (!readiness.ok)
          throw new Error("Podo Agent is available only in the demo workspace.")
        const readinessBody = (await readiness.json()) as {
          chat?: { available?: boolean }
        }
        if (!readinessBody.chat?.available)
          throw new Error("Podo Agent is not ready. Check the Core runtime.")

        const created = await fetch("/api/podo/agent/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: controller.signal,
        })
        if (!created.ok) throw new Error("Podo Agent could not start a chat.")
        const result = (await created.json()) as CreateAgentChatResponse
        chatId = result.chat.id
        chatIdRef.current = chatId
        lastSequenceRef.current = result.chat.lastSequence
      }

      const accepted = await fetch(
        `/api/podo/agent/chats/${encodeURIComponent(chatId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: prompt,
            clientRequestId: userMessage.id,
          }),
          signal: controller.signal,
        },
      )
      if (!accepted.ok)
        throw new Error("Podo Agent could not accept this message.")
      setThinkingStage(1)

      const response = await fetch(
        `/api/podo/agent/chats/${encodeURIComponent(chatId)}/events?after=${lastSequenceRef.current}`,
        {
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        },
      )
      if (!response.ok) throw new Error("Podo Agent stream unavailable.")

      await readAgentEvents(response, (event) => {
        lastSequenceRef.current = Math.max(
          lastSequenceRef.current,
          event.sequence,
        )
        if (event.kind === "message.accepted") {
          setThinkingStage(1)
        } else if (event.kind === "output.delta") {
          outputDeltaCount += 1
          setThinkingStage(outputDeltaCount === 1 ? 2 : 3)
          receivedText = true
          updateMessage(assistantMessage.id, (message) => ({
            ...message,
            text: message.text + event.payload.text,
            state: "streaming",
          }))
        } else if (event.kind === "message.completed") {
          receivedText = true
          updateMessage(assistantMessage.id, (message) => ({
            ...message,
            text: event.payload.message.content,
            state: "streaming",
            ...(event.payload.message.answer
              ? { structured: event.payload.message.answer }
              : {}),
          }))
        } else if (event.kind === "chat.failed") {
          throw new Error(event.payload.error.message)
        } else if (event.kind === "turn.cancelled") {
          updateMessage(assistantMessage.id, (message) => ({
            ...message,
            text: message.text || "The agent turn was cancelled.",
            state: "stopped",
          }))
        }
      })

      updateMessage(assistantMessage.id, (message) => {
        const text =
          message.text ||
          (receivedText
            ? message.text
            : "The investigation completed without a written response.")
        const structured = message.structured ?? parseStructuredAnswer(text)
        return {
          ...message,
          durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
          text,
          state: "complete",
          ...(structured ? { structured } : {}),
        }
      })
    } catch (error) {
      if (controller.signal.aborted) return
      updateMessage(assistantMessage.id, (message) => ({
        ...message,
        text:
          message.text ||
          (error instanceof Error
            ? error.message
            : "Podo Agent could not complete this request."),
        state: "failed",
      }))
    } finally {
      if (!controller.signal.aborted) {
        abortRef.current = null
        setActiveMessageId(null)
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage(draft)
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopiedMessageId(message.id)
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId(null)
        copyTimerRef.current = null
      }, 1_500)
    } catch {
      setCopiedMessageId(null)
    }
  }

  function toggleMessage(messageId: string) {
    setCollapsedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  function retryMessage(message: ChatMessage, previousMessage: ChatMessage) {
    if (retryingMessageId) return
    setRetryingMessageId(message.id)
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      setRetryingMessageId(null)
      void sendMessage(previousMessage.text)
    }, 320)
  }

  function clearChat() {
    cancelAgentTurn()
    chatIdRef.current = null
    lastSequenceRef.current = 0
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = null
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    setActiveMessageId(null)
    setMessages([])
    setDraft("")
    setCollapsedMessageIds(new Set())
    setCopiedMessageId(null)
    setRetryingMessageId(null)
    setTurnAnchorId(null)
    try {
      window.localStorage.removeItem(historyStorageKey)
    } catch {
      // Clearing the in-memory history is still useful without storage access.
    }
    if (conversationRef.current) conversationRef.current.scrollTop = 0
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <>
      <button
        aria-label="Close Podo Agent"
        className="agent-panel-scrim"
        onClick={() => {
          cancelAgentTurn()
          onClose()
        }}
        type="button"
      />
      <aside aria-label="Podo Agent" className="agent-panel" role="dialog">
        <header className="agent-panel-header">
          <span className="agent-avatar">
            <Icon name="robot" size={18} />
            <i aria-hidden="true" />
          </span>
          <div>
            <strong>Podo Agent</strong>
            <small>Evidence-first investigation</small>
          </div>
          <button
            aria-label="Clear chat"
            className="agent-clear-button"
            disabled={messages.length === 0 && !activeMessageId}
            onClick={clearChat}
            type="button"
          >
            <Icon name="clock" size={13} />
            <span>Clear chat</span>
          </button>
          <span className="agent-mode-badge">
            <Icon name="shield-check" size={13} /> Read-only
          </span>
          <button
            aria-label="Close agent"
            className="agent-close-button"
            onClick={() => {
              cancelAgentTurn()
              onClose()
            }}
            type="button"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="agent-context">
          <span>Project context</span>
          <strong>{projectLabel}</strong>
          <small>{projectScope}</small>
        </div>

        <div
          aria-label="Conversation with Podo Agent"
          className="agent-conversation"
          ref={conversationRef}
        >
          {messages.length === 0 ? (
            <div className="agent-empty">
              <span className="agent-empty-mark">
                <Icon name="robot" size={21} />
              </span>
              <h2>Investigate across the project</h2>
              <p>
                Ask about incidents, services, deployments, or code. Podo traces
                evidence without making changes.
              </p>
              <div className="agent-suggestions">
                <div className="agent-preview-label">
                  <Icon name="robot" size={13} /> Suggested demo prompts
                </div>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => void sendMessage(suggestion)}
                    type="button"
                  >
                    <span>{suggestion}</span>
                    <Icon name="caret-right" size={14} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              const previousMessage = index > 0 ? messages[index - 1] : null
              const isWorking =
                message.state === "thinking" || message.state === "streaming"
              const hasInlineSurface = isWorking || Boolean(message.structured)
              return (
                <article
                  className={`agent-message agent-message-${message.role}`}
                  data-state={message.state}
                  key={message.id}
                  ref={message.id === turnAnchorId ? turnAnchorRef : undefined}
                >
                  {!hasInlineSurface ? (
                    <header>
                      {message.role === "assistant" ? (
                        <span className="agent-message-avatar">
                          <Icon name="robot" size={13} />
                        </span>
                      ) : null}
                      <strong>
                        {message.role === "assistant" ? "Podo Agent" : "You"}
                      </strong>
                      {message.state === "failed" ? (
                        <small>Failed</small>
                      ) : null}
                      {message.state === "stopped" ? (
                        <small>Stopped</small>
                      ) : null}
                    </header>
                  ) : null}
                  {isWorking ? (
                    <ThinkingState
                      projectLabel={projectLabel}
                      stage={thinkingStage}
                    />
                  ) : message.structured ? (
                    <AgentAnswer
                      answer={message.structured}
                      collapsed={collapsedMessageIds.has(message.id)}
                      copied={copiedMessageId === message.id}
                      {...(message.durationMs
                        ? { durationMs: message.durationMs }
                        : {})}
                      onCopy={() => void copyMessage(message)}
                      onRetry={() => {
                        if (previousMessage?.role === "user")
                          retryMessage(message, previousMessage)
                      }}
                      onToggle={() => toggleMessage(message.id)}
                      retrying={retryingMessageId === message.id}
                    />
                  ) : (
                    <p>{message.text}</p>
                  )}
                </article>
              )
            })
          )}
        </div>

        <form className="agent-composer" onSubmit={submit}>
          <div className="agent-composer-heading">
            <label htmlFor="agent-message">Message Podo</label>
            {activeMessageId ? (
              <button onClick={stopActive} type="button">
                <Icon name="x" size={12} /> Stop
              </button>
            ) : (
              <span>Enter to send</span>
            )}
          </div>
          <div className="agent-composer-input">
            <textarea
              disabled={Boolean(activeMessageId)}
              id="agent-message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage(draft)
                }
              }}
              placeholder="Ask about incidents, services, deployments, or code..."
              ref={inputRef}
              rows={2}
              value={draft}
            />
            <button
              aria-label="Send message"
              disabled={!draft.trim() || Boolean(activeMessageId)}
              type="submit"
            >
              <Icon name="caret-up" size={17} />
            </button>
          </div>
          <small>
            Demo-only and read-only. Podo cannot approve or perform changes.
          </small>
        </form>
      </aside>
    </>
  )
}
