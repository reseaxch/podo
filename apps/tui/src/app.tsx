import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useState } from "react"

export type TuiRunStatus =
  | "loading"
  | "idle"
  | "degraded"
  | "running"
  | "waiting_for_approval"
  | "failed"
  | "completed"

export type TuiAutonomyMode = "observe" | "recommend" | "act_with_approval"
export type TuiSandboxMode = "read-only" | "workspace-write"

export interface TuiSettings {
  mode: TuiAutonomyMode
  monitoringEnabled: boolean
  sandbox: TuiSandboxMode
  timeoutSeconds: number
}

export interface PodoTuiViewModel {
  status: TuiRunStatus
  statusDetail?: string
  incidentTitle?: string
  evidence: readonly string[]
  pendingApproval?: {
    id: string
    summary: string
  }
  settings: TuiSettings
}

export interface PodoTuiController {
  approve(approvalId: string): void
  deny(approvalId: string): void
  cancel(): void
  saveSettings(settings: TuiSettings): void
}

export interface PodoTuiProps {
  coreUrl: string
  viewModel?: PodoTuiViewModel
  controller?: PodoTuiController
}

type FocusArea = "run" | "settings"
type SettingsField = keyof TuiSettings

const SETTINGS_FIELDS: readonly SettingsField[] = ["mode", "monitoringEnabled", "sandbox", "timeoutSeconds"]
const MODES: readonly TuiAutonomyMode[] = ["observe", "recommend", "act_with_approval"]
const TIMEOUT_STEP_SECONDS = 15

const defaultViewModel: PodoTuiViewModel = {
  status: "loading",
  statusDetail: "Connecting to core",
  evidence: [],
  settings: {
    mode: "recommend",
    monitoringEnabled: true,
    sandbox: "read-only",
    timeoutSeconds: 60,
  },
}

const noOpController: PodoTuiController = {
  approve() {},
  deny() {},
  cancel() {},
  saveSettings() {},
}

const statusLabels: Record<TuiRunStatus, string> = {
  loading: "LOADING",
  idle: "READY / IDLE",
  degraded: "DEGRADED",
  running: "RUNNING",
  waiting_for_approval: "WAITING FOR APPROVAL",
  failed: "FAILED",
  completed: "COMPLETED",
}

const statusColors: Record<TuiRunStatus, string> = {
  loading: "#fbbf24",
  idle: "#7dd3fc",
  degraded: "#fb923c",
  running: "#a78bfa",
  waiting_for_approval: "#fbbf24",
  failed: "#f87171",
  completed: "#4ade80",
}

function cycle<T>(items: readonly T[], current: T, direction: 1 | -1): T {
  const index = items.indexOf(current)
  return items[(index + direction + items.length) % items.length]!
}

function adjustSetting(settings: TuiSettings, field: SettingsField, direction: 1 | -1): TuiSettings {
  if (field === "mode") return { ...settings, mode: cycle(MODES, settings.mode, direction) }
  if (field === "monitoringEnabled") return { ...settings, monitoringEnabled: !settings.monitoringEnabled }
  if (field === "sandbox") {
    return { ...settings, sandbox: settings.sandbox === "read-only" ? "workspace-write" : "read-only" }
  }
  return {
    ...settings,
    timeoutSeconds: Math.max(TIMEOUT_STEP_SECONDS, settings.timeoutSeconds + direction * TIMEOUT_STEP_SECONDS),
  }
}

function settingMarker(active: boolean): string {
  return active ? ">" : " "
}

function modeLabel(mode: TuiAutonomyMode): string {
  return mode === "act_with_approval" ? "act-with-approval" : mode
}

function isPlainSinglePress(key: {
  eventType: "press" | "repeat" | "release"
  repeated?: boolean
  ctrl: boolean
  shift: boolean
  meta: boolean
  option: boolean
  super?: boolean
  hyper?: boolean
}): boolean {
  return (
    key.eventType === "press" &&
    !key.repeated &&
    !key.ctrl &&
    !key.shift &&
    !key.meta &&
    !key.option &&
    !key.super &&
    !key.hyper
  )
}

export function PodoTui({ coreUrl, viewModel = defaultViewModel, controller = noOpController }: PodoTuiProps) {
  const renderer = useRenderer()
  const { width } = useTerminalDimensions()
  const [focus, setFocus] = useState<FocusArea>("run")
  const [editing, setEditing] = useState(false)
  const [fieldIndex, setFieldIndex] = useState(0)
  const [draft, setDraft] = useState<TuiSettings>(viewModel.settings)

  const settings = editing ? draft : viewModel.settings
  const activeField = SETTINGS_FIELDS[fieldIndex]!
  const narrow = width < 80
  const pendingApproval = viewModel.status === "waiting_for_approval" ? viewModel.pendingApproval : undefined

  useKeyboard((key) => {
    if (key.eventType === "release") return

    if (editing) {
      if (key.name === "escape") {
        setDraft(viewModel.settings)
        setEditing(false)
        return
      }
      if (key.name === "tab") {
        setFieldIndex((current) => (current + (key.shift ? -1 : 1) + SETTINGS_FIELDS.length) % SETTINGS_FIELDS.length)
        return
      }
      if (key.name === "left" || key.name === "down") {
        setDraft((current) => adjustSetting(current, activeField, -1))
        return
      }
      if (key.name === "right" || key.name === "up" || key.name === "space") {
        setDraft((current) => adjustSetting(current, activeField, 1))
        return
      }
      if ((key.ctrl && key.name === "s") || key.name === "return") {
        controller.saveSettings(draft)
        setEditing(false)
      }
      return
    }

    if (key.name === "tab") {
      setFocus((current) => (current === "run" ? "settings" : "run"))
      return
    }
    if (key.name === "e" && focus === "settings") {
      setDraft(viewModel.settings)
      setFieldIndex(0)
      setEditing(true)
      return
    }
    const canDispatchDestructiveAction = isPlainSinglePress(key)
    if (key.name === "a" && canDispatchDestructiveAction && focus === "run" && pendingApproval) {
      controller.approve(pendingApproval.id)
      return
    }
    if (key.name === "d" && canDispatchDestructiveAction && focus === "run" && pendingApproval) {
      controller.deny(pendingApproval.id)
      return
    }
    if (
      key.name === "c" &&
      canDispatchDestructiveAction &&
      focus === "run" &&
      (viewModel.status === "running" || pendingApproval)
    ) {
      controller.cancel()
      return
    }
    if (key.name === "escape" || key.name === "q") renderer.destroy()
  })

  const evidence = viewModel.evidence.length === 0 ? ["No evidence selected"] : viewModel.evidence

  return (
    <box style={{ flexDirection: "column", gap: 1, padding: 1 }}>
      <box title="Podo" style={{ border: true, paddingX: 1, height: 3, flexDirection: "row" }}>
        <text fg="#7dd3fc">incident → evidence → root cause → tested fix → pull request</text>
        {!narrow && <text fg="#64748b">  Core: {coreUrl}</text>}
      </box>

      <box style={{ flexDirection: narrow ? "column" : "row", gap: 1, flexGrow: 1 }}>
        <box
          title={`${focus === "run" && !editing ? "> " : ""}Run`}
          style={{ border: true, padding: 1, flexDirection: "column", gap: 1, flexGrow: 2 }}
        >
          <text fg={statusColors[viewModel.status]}>Status: {statusLabels[viewModel.status]}</text>
          {viewModel.statusDetail && <text>{viewModel.statusDetail}</text>}
          {viewModel.incidentTitle && <text>Incident: {viewModel.incidentTitle}</text>}
          <text fg="#94a3b8">Evidence ({viewModel.evidence.length})</text>
          {evidence.slice(0, narrow ? 2 : 4).map((item, index) => (
            <text key={`${index}:${item}`}>• {item}</text>
          ))}
          {pendingApproval && (
            <box title="Human approval required" style={{ border: true, paddingX: 1, flexDirection: "column" }}>
              <text fg="#fbbf24">{pendingApproval.summary}</text>
              <text>[a] approve  [d] deny  [c] cancel</text>
            </box>
          )}
        </box>

        <box
          title={`${focus === "settings" || editing ? "> " : ""}Settings${editing ? " · EDITING" : ""}`}
          style={{ border: true, padding: 1, flexDirection: "column", gap: 1, flexGrow: 1, minWidth: narrow ? 0 : 32 }}
        >
          <text>{settingMarker(editing && activeField === "mode")} Mode: {modeLabel(settings.mode)}</text>
          <text>{settingMarker(editing && activeField === "monitoringEnabled")} Monitoring: {settings.monitoringEnabled ? "on" : "off"}</text>
          <text>{settingMarker(editing && activeField === "sandbox")} Sandbox: {settings.sandbox}</text>
          <text>{settingMarker(editing && activeField === "timeoutSeconds")} Timeout: {settings.timeoutSeconds}s</text>
          <text fg="#94a3b8">
            {editing ? "Tab field · ←/→ change · Enter/Ctrl-S save · Esc discard" : "Tab focus · e edit"}
          </text>
        </box>
      </box>

      <text fg="#64748b">q/Esc exit · approvals are never automatic</text>
    </box>
  )
}
