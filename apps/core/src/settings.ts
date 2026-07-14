import type { RootlineSettings, UpdateSettingsRequest } from "@rootline/contracts"

const settingKeys = new Set<keyof RootlineSettings>([
  "autonomyMode",
  "monitoringEnabled",
  "defaultSandbox",
  "turnTimeoutMs",
])

export const defaultSettings: Readonly<RootlineSettings> = Object.freeze({
  autonomyMode: "observe",
  monitoringEnabled: true,
  defaultSandbox: "read-only",
  turnTimeoutMs: 60_000,
})

export class SettingsStore {
  private current: RootlineSettings = { ...defaultSettings }

  get(): RootlineSettings {
    return { ...this.current }
  }

  update(input: unknown): RootlineSettings | null {
    if (!isSettingsPatch(input)) return null
    this.current = { ...this.current, ...input }
    return this.get()
  }
}

function isSettingsPatch(value: unknown): value is UpdateSettingsRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length === 0 || keys.some((key) => !settingKeys.has(key as keyof RootlineSettings))) return false

  if ("autonomyMode" in input && !["observe", "recommend", "act_with_approval"].includes(input.autonomyMode as string)) return false
  if ("monitoringEnabled" in input && typeof input.monitoringEnabled !== "boolean") return false
  if ("defaultSandbox" in input && input.defaultSandbox !== "read-only" && input.defaultSandbox !== "workspace-write") return false
  if ("turnTimeoutMs" in input && (!Number.isSafeInteger(input.turnTimeoutMs) || (input.turnTimeoutMs as number) < 1_000 || (input.turnTimeoutMs as number) > 3_600_000)) return false
  return true
}
