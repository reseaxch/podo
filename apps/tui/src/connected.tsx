import { createPodoClient, type PodoClient } from "@podo/client"
import type {
  DetectedIncident,
  Investigation,
  InvestigationApproval,
  InvestigationEvent,
  InvestigationToolKind,
  PodoSettings,
  SystemStatusResponse,
} from "@podo/contracts"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  PodoTui,
  type PodoTuiController,
  type PodoTuiViewModel,
  type TuiInvestigationActivity,
  type TuiInvestigationStreamStatus,
  type TuiSettings,
} from "./app"

const MAX_ACTIVITY_EVENTS = 32
const DEFAULT_RECONNECT_DELAY_MS = 250
const TOOL_ACTIVITY_LABELS: Record<InvestigationToolKind, string> = {
  command: "Command",
  file_change: "File change",
  mcp: "MCP",
  dynamic: "Dynamic",
  collaboration: "Collaboration",
  web_search: "Web search",
  image_view: "Image view",
  sleep: "Sleep",
  image_generation: "Image generation",
}

interface CoreSnapshot {
  system: SystemStatusResponse
  settings: PodoSettings
  incidents: readonly DetectedIncident[]
  selectedInvestigation: {
    incidentId: string
    investigation: Investigation
  } | null
}

interface InvestigationStreamView {
  investigationId: string
  status: TuiInvestigationStreamStatus
  activity: readonly TuiInvestigationActivity[]
}

interface ActiveStream {
  investigationId: string
  controller: AbortController
}

type AdapterNotice = "settings_failed" | "action_failed"

const initialViewModel: PodoTuiViewModel = {
  status: "loading",
  statusDetail: "Connecting to core",
  evidence: [],
  settings: {
    mode: "observe",
    monitoringEnabled: true,
    sandbox: "read-only",
    timeoutSeconds: 60,
  },
}

export function toTuiSettings(settings: PodoSettings): TuiSettings {
  return {
    mode: settings.autonomyMode,
    monitoringEnabled: settings.monitoringEnabled,
    sandbox: settings.defaultSandbox,
    timeoutSeconds: settings.turnTimeoutMs / 1_000,
  }
}

export function toPodoSettings(settings: TuiSettings): PodoSettings {
  return {
    autonomyMode: settings.mode,
    monitoringEnabled: settings.monitoringEnabled,
    defaultSandbox: settings.sandbox,
    turnTimeoutMs: settings.timeoutSeconds * 1_000,
  }
}

export function selectIncident(incidents: readonly DetectedIncident[]): DetectedIncident | undefined {
  for (let index = incidents.length - 1; index >= 0; index -= 1) {
    const incident = incidents[index]
    if (incident?.investigation) return incident
  }
  return incidents.at(-1)
}

export function toTuiRunStatus(status: Investigation["status"]): PodoTuiViewModel["status"] {
  switch (status) {
    case "starting": return "loading"
    case "running": return "running"
    case "waiting_for_approval": return "waiting_for_approval"
    case "completed": return "completed"
    case "cancelled": return "cancelled"
    case "failed": return "failed"
  }
}

export function toTuiActivity(event: InvestigationEvent): TuiInvestigationActivity {
  const label = (() => {
    switch (event.kind) {
      case "investigation.started": return "Investigation started"
      case "investigation.running": return "Investigation running"
      case "output.delta": return "Agent output received"
      case "tool.step":
        return `${TOOL_ACTIVITY_LABELS[event.payload.step.tool]} tool ${event.payload.step.status}`
      case "approval.requested": return "Approval requested"
      case "approval.resolved": return "Approval resolved"
      case "investigation.completed": return "Investigation completed"
      case "investigation.cancelled": return "Investigation cancelled"
      case "investigation.failed": return "Investigation failed"
    }
  })()

  return { sequence: event.sequence, occurredAt: event.timestamp, label }
}

export function shouldReplaceInvestigation(current: Investigation | null, next: Investigation): boolean {
  return current !== null
    && current.id === next.id
    && next.lastSequence > current.lastSequence
}

export function shouldAbortActiveStream(
  activeInvestigationId: string | null,
  responseInvestigationId: string,
): boolean {
  return activeInvestigationId === responseInvestigationId
}

function sanitizeApproval(approval: InvestigationApproval): InvestigationApproval {
  return {
    id: approval.id,
    kind: approval.kind,
    status: approval.status,
  }
}

function sanitizeInvestigation(investigation: Investigation): Investigation {
  const { error: _ignoredError, pendingApproval, ...safeInvestigation } = investigation
  return {
    ...safeInvestigation,
    pendingApproval: pendingApproval ? sanitizeApproval(pendingApproval) : null,
  }
}

function isTerminalStatus(status: Investigation["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed"
}

function isTerminalEvent(event: InvestigationEvent): boolean {
  return event.kind === "investigation.completed"
    || event.kind === "investigation.cancelled"
    || event.kind === "investigation.failed"
}

function approvalSummary(approval: InvestigationApproval): string {
  const kind = approval.kind.replaceAll("_", " ")
  return `Core requests explicit approval for ${kind}.`
}

function investigationStatusDetail(
  investigation: Investigation,
  streamStatus: TuiInvestigationStreamStatus,
): string {
  if (streamStatus === "reconnecting" && !isTerminalStatus(investigation.status)) {
    return "Core event stream is reconnecting."
  }

  switch (investigation.status) {
    case "starting": return "Core is starting the selected incident investigation."
    case "running": return "Core is investigating the selected incident."
    case "waiting_for_approval": return "Core requires an explicit approval."
    case "completed": return "Core completed the incident investigation."
    case "cancelled": return "Core cancelled the incident investigation."
    case "failed": return "Core marked the incident investigation as failed."
  }
}

function noticeDetail(notice: AdapterNotice | null): string | undefined {
  if (notice === "settings_failed") return "Core did not save the requested settings."
  if (notice === "action_failed") return "Core did not accept the requested investigation action."
  return undefined
}

export function toTuiViewModel(
  system: SystemStatusResponse,
  settings: PodoSettings,
  incidents: readonly DetectedIncident[],
  currentInvestigation: Investigation | null = null,
  stream: InvestigationStreamView | null = null,
  notice: AdapterNotice | null = null,
): PodoTuiViewModel {
  const selected = selectIncident(incidents)
  const investigation = selected?.investigation?.id === currentInvestigation?.id
    ? currentInvestigation
    : undefined
  const streamStatus = stream && stream.investigationId === investigation?.id
    ? stream.status
    : investigation && isTerminalStatus(investigation.status)
      ? "complete"
      : "connecting"
  const safeNotice = noticeDetail(notice)

  if (system.status !== "ready") {
    return {
      status: "degraded",
      statusDetail: safeNotice ?? "Core or Codex is unavailable.",
      ...(selected ? { incidentTitle: `${selected.affectedService} · ${selected.detector}` } : {}),
      evidence: selected?.evidence.map((item) => `${item.sourceType}: ${item.sourceEventId}`) ?? [],
      settings: toTuiSettings(settings),
    }
  }

  if (!selected) {
    return {
      status: "idle",
      statusDetail: safeNotice ?? "Core and Codex are ready",
      evidence: [],
      settings: toTuiSettings(settings),
    }
  }

  if (selected.investigation && !investigation) {
    return {
      status: "degraded",
      statusDetail: safeNotice ?? "Core investigation details are unavailable.",
      incidentTitle: `${selected.affectedService} · ${selected.detector}`,
      evidence: selected.evidence.map((item) => `${item.sourceType}: ${item.sourceEventId}`),
      settings: toTuiSettings(settings),
    }
  }

  if (!investigation) {
    return {
      status: "idle",
      statusDetail: safeNotice ?? "Core and Codex are ready",
      incidentTitle: `${selected.affectedService} · ${selected.detector}`,
      evidence: selected.evidence.map((item) => `${item.sourceType}: ${item.sourceEventId}`),
      settings: toTuiSettings(settings),
    }
  }

  return {
    status: toTuiRunStatus(investigation.status),
    statusDetail: safeNotice ?? investigationStatusDetail(investigation, streamStatus),
    incidentTitle: `${selected.affectedService} · ${selected.detector}`,
    evidence: selected.evidence.map((item) => `${item.sourceType}: ${item.sourceEventId}`),
    ...(investigation.pendingApproval?.status === "pending" && investigation.status === "waiting_for_approval"
      ? { pendingApproval: { id: investigation.pendingApproval.id, summary: approvalSummary(investigation.pendingApproval) } }
      : {}),
    investigation: {
      id: investigation.id,
      streamStatus,
      activity: stream?.investigationId === investigation.id ? stream.activity : [],
    },
    settings: toTuiSettings(settings),
  }
}

function applyInvestigationEvent(
  investigation: Investigation,
  event: InvestigationEvent,
): Investigation {
  if (event.investigationId !== investigation.id || event.sequence <= investigation.lastSequence) {
    return investigation
  }

  const { error: _ignoredError, ...base } = sanitizeInvestigation(investigation)
  const next = {
    ...base,
    lastSequence: event.sequence,
    updatedAt: event.timestamp,
  }

  switch (event.kind) {
    case "investigation.started":
      return { ...next, status: "starting", pendingApproval: null }
    case "investigation.running":
      return { ...next, status: "running", pendingApproval: null }
    case "output.delta":
    case "tool.step":
      return next
    case "approval.requested":
      return {
        ...next,
        status: "waiting_for_approval",
        pendingApproval: sanitizeApproval(event.payload.approval),
      }
    case "approval.resolved":
      return { ...next, status: "running", pendingApproval: null }
    case "investigation.completed":
      return { ...next, status: "completed", pendingApproval: null }
    case "investigation.cancelled":
      return { ...next, status: "cancelled", pendingApproval: null }
    case "investigation.failed":
      return { ...next, status: "failed", pendingApproval: null }
  }
}

function replaceInvestigation(
  snapshot: CoreSnapshot,
  incidentId: string,
  investigation: Investigation,
): CoreSnapshot {
  const current = snapshot.selectedInvestigation
  if (
    !current
    || current.incidentId !== incidentId
    || !shouldReplaceInvestigation(current.investigation, investigation)
  ) return snapshot

  return {
    ...snapshot,
    selectedInvestigation: {
      incidentId,
      investigation: sanitizeInvestigation(investigation),
    },
  }
}

function appendActivity(
  activity: readonly TuiInvestigationActivity[],
  event: TuiInvestigationActivity,
): readonly TuiInvestigationActivity[] {
  return [...activity, event].slice(-MAX_ACTIVITY_EVENTS)
}

function isReplayExpired(error: unknown): boolean {
  return String(error).includes("event_replay_expired")
}

function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs === 0) return Promise.resolve()

  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export function ConnectedPodoTui({
  coreUrl,
  client: injectedClient,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
}: {
  coreUrl: string
  client?: PodoClient
  reconnectDelayMs?: number
}) {
  const client = useMemo(
    () => injectedClient ?? createPodoClient({ baseUrl: coreUrl }),
    [coreUrl, injectedClient],
  )
  const [snapshot, setSnapshot] = useState<CoreSnapshot | null>(null)
  const [stream, setStream] = useState<InvestigationStreamView | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  const [notice, setNotice] = useState<AdapterNotice | null>(null)
  const cursors = useRef(new Map<string, number>())
  const actionInFlight = useRef(false)
  const streamAbort = useRef<ActiveStream | null>(null)

  useEffect(() => {
    let active = true
    setSnapshot(null)
    setStream(null)
    setInitialLoadFailed(false)
    setNotice(null)

    void Promise.all([client.systemStatus(), client.getSettings(), client.listIncidents()])
      .then(async ([system, nextSettings, incidents]) => {
        const selected = selectIncident(incidents.incidents)
        const investigationLink = selected?.investigation
        const response = investigationLink
          ? await client.getInvestigation(investigationLink.id)
          : null
        if (response && response.investigation.id !== investigationLink?.id) {
          throw new Error("Core returned a different investigation")
        }
        if (!active) return
        setSnapshot({
          system,
          settings: nextSettings.settings,
          incidents: incidents.incidents,
          selectedInvestigation: selected && response
            ? { incidentId: selected.id, investigation: sanitizeInvestigation(response.investigation) }
            : null,
        })
      })
      .catch(() => {
        if (active) setInitialLoadFailed(true)
      })

    return () => {
      active = false
    }
  }, [client])

  const selectedInvestigation = snapshot?.selectedInvestigation?.investigation
  const selectedIncidentId = snapshot?.selectedInvestigation?.incidentId
  const selectedInvestigationId = selectedInvestigation?.id

  useEffect(() => {
    if (!selectedIncidentId || !selectedInvestigation) {
      setStream(null)
      return
    }

    const controller = new AbortController()
    const investigationId = selectedInvestigation.id
    streamAbort.current = { investigationId, controller }
    let cursor = Math.max(cursors.current.get(investigationId) ?? 0, selectedInvestigation.lastSequence)
    let activity: readonly TuiInvestigationActivity[] = []
    cursors.current.set(investigationId, cursor)
    setStream({
      investigationId,
      status: isTerminalStatus(selectedInvestigation.status) ? "complete" : "connecting",
      activity,
    })

    if (isTerminalStatus(selectedInvestigation.status)) {
      return () => {
        if (streamAbort.current?.controller === controller) streamAbort.current = null
        controller.abort()
      }
    }

    const run = async () => {
      let reconnecting = false
      while (!controller.signal.aborted) {
        setStream({
          investigationId,
          status: reconnecting ? "reconnecting" : "connecting",
          activity,
        })
        let terminal = false

        try {
          for await (const event of client.subscribeEvents(investigationId, {
            afterSequence: cursor,
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) return
            if (event.investigationId !== investigationId || event.sequence <= cursor) continue

            cursor = event.sequence
            cursors.current.set(investigationId, cursor)
            activity = appendActivity(activity, toTuiActivity(event))
            setStream({
              investigationId,
              status: isTerminalEvent(event) ? "complete" : "live",
              activity,
            })
            setSnapshot((current) => current
              && current.selectedInvestigation?.incidentId === selectedIncidentId
              && current.selectedInvestigation.investigation.id === investigationId
              ? replaceInvestigation(
                current,
                selectedIncidentId,
                applyInvestigationEvent(current.selectedInvestigation.investigation, event),
              )
              : current)
            setNotice(null)

            if (isTerminalEvent(event)) {
              terminal = true
              break
            }
          }
          if (terminal || controller.signal.aborted) return
        } catch (error) {
          if (controller.signal.aborted) return
          if (isReplayExpired(error)) {
            try {
              const response = await client.getInvestigation(investigationId)
              if (controller.signal.aborted) return
              const refreshedInvestigation = sanitizeInvestigation(response.investigation)
              setSnapshot((current) => current
                ? replaceInvestigation(current, selectedIncidentId, refreshedInvestigation)
                : current)
              if (refreshedInvestigation.id !== investigationId) return
              cursor = Math.max(cursor, refreshedInvestigation.lastSequence)
              cursors.current.set(investigationId, cursor)
              if (isTerminalStatus(refreshedInvestigation.status)) {
                setStream({ investigationId, status: "complete", activity })
                return
              }
              reconnecting = true
              continue
            } catch {
              if (controller.signal.aborted) return
            }
          }
        }

        reconnecting = true
        setStream({ investigationId, status: "reconnecting", activity })
        await waitForReconnect(reconnectDelayMs, controller.signal)
      }
    }

    void run()
    return () => {
      if (streamAbort.current?.controller === controller) streamAbort.current = null
      controller.abort()
    }
  }, [client, reconnectDelayMs, selectedIncidentId, selectedInvestigationId])

  const selection = selectedIncidentId && selectedInvestigation && snapshot?.system.status === "ready"
    ? { incidentId: selectedIncidentId, investigation: selectedInvestigation }
    : null
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const controller = useMemo<PodoTuiController>(() => ({
    approve(approvalId) {
      const current = selectionRef.current
      if (
        !current
        || actionInFlight.current
        || current.investigation.status !== "waiting_for_approval"
        || current.investigation.pendingApproval?.id !== approvalId
        || current.investigation.pendingApproval.status !== "pending"
      ) return

      actionInFlight.current = true
      void client.approve(current.investigation.id, approvalId)
        .then((response) => {
          cursors.current.set(
            response.investigation.id,
            Math.max(cursors.current.get(response.investigation.id) ?? 0, response.investigation.lastSequence),
          )
          setSnapshot((snapshot) => snapshot
            ? replaceInvestigation(snapshot, current.incidentId, response.investigation)
            : snapshot)
          setNotice(null)
        })
        .catch(() => setNotice("action_failed"))
        .finally(() => { actionInFlight.current = false })
    },
    deny(approvalId) {
      const current = selectionRef.current
      if (
        !current
        || actionInFlight.current
        || current.investigation.status !== "waiting_for_approval"
        || current.investigation.pendingApproval?.id !== approvalId
        || current.investigation.pendingApproval.status !== "pending"
      ) return

      actionInFlight.current = true
      void client.deny(current.investigation.id, approvalId)
        .then((response) => {
          cursors.current.set(
            response.investigation.id,
            Math.max(cursors.current.get(response.investigation.id) ?? 0, response.investigation.lastSequence),
          )
          setSnapshot((snapshot) => snapshot
            ? replaceInvestigation(snapshot, current.incidentId, response.investigation)
            : snapshot)
          setNotice(null)
        })
        .catch(() => setNotice("action_failed"))
        .finally(() => { actionInFlight.current = false })
    },
    cancel() {
      const current = selectionRef.current
      if (
        !current
        || actionInFlight.current
        || isTerminalStatus(current.investigation.status)
      ) return

      actionInFlight.current = true
      void client.cancel(current.investigation.id)
        .then((response) => {
          cursors.current.set(
            response.investigation.id,
            Math.max(cursors.current.get(response.investigation.id) ?? 0, response.investigation.lastSequence),
          )
          setSnapshot((snapshot) => snapshot
            ? replaceInvestigation(snapshot, current.incidentId, response.investigation)
            : snapshot)
          if (isTerminalStatus(response.investigation.status)) {
            const activeStream = streamAbort.current
            if (
              activeStream
              && shouldAbortActiveStream(activeStream.investigationId, response.investigation.id)
            ) {
              activeStream.controller.abort()
            }
            setStream((stream) => stream?.investigationId === response.investigation.id
              ? { ...stream, status: "complete" }
              : stream)
          }
          setNotice(null)
        })
        .catch(() => setNotice("action_failed"))
        .finally(() => { actionInFlight.current = false })
    },
    saveSettings(nextSettings) {
      void client.updateSettings(toPodoSettings(nextSettings))
        .then((response) => {
          setSnapshot((snapshot) => snapshot
            ? { ...snapshot, settings: response.settings }
            : snapshot)
          setNotice(null)
        })
        .catch(() => setNotice("settings_failed"))
    },
  }), [client])

  const viewModel = useMemo<PodoTuiViewModel>(() => {
    if (!snapshot) {
      return initialLoadFailed
        ? { ...initialViewModel, status: "degraded", statusDetail: "Core is unavailable." }
        : initialViewModel
    }
    return toTuiViewModel(
      snapshot.system,
      snapshot.settings,
      snapshot.incidents,
      snapshot.selectedInvestigation?.investigation ?? null,
      stream,
      notice,
    )
  }, [initialLoadFailed, notice, snapshot, stream])

  return <PodoTui coreUrl={coreUrl} controller={controller} viewModel={viewModel} />
}
