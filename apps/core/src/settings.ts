import type { PodoSettings, UpdateSettingsRequest } from "@podo/contracts"

const settingKeys = new Set<keyof PodoSettings>([
  "autonomyMode",
  "monitoringEnabled",
  "defaultSandbox",
  "turnTimeoutMs",
])

export const defaultSettings: Readonly<PodoSettings> = Object.freeze({
  autonomyMode: "observe",
  monitoringEnabled: true,
  defaultSandbox: "read-only",
  turnTimeoutMs: 60_000,
})

export class SettingsStore {
  private current: PodoSettings = { ...defaultSettings }

  get(): PodoSettings {
    return { ...this.current }
  }

  update(input: unknown): PodoSettings | null {
    if (!isSettingsPatch(input)) return null
    this.current = { ...this.current, ...input }
    return this.get()
  }
}

function isSettingsPatch(value: unknown): value is UpdateSettingsRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length === 0 || keys.some((key) => !settingKeys.has(key as keyof PodoSettings))) return false

  if ("autonomyMode" in input && !["observe", "recommend", "act_with_approval"].includes(input.autonomyMode as string)) return false
  if ("monitoringEnabled" in input && typeof input.monitoringEnabled !== "boolean") return false
  if ("defaultSandbox" in input && input.defaultSandbox !== "read-only" && input.defaultSandbox !== "workspace-write") return false
  if ("turnTimeoutMs" in input && (!Number.isSafeInteger(input.turnTimeoutMs) || (input.turnTimeoutMs as number) < 1_000 || (input.turnTimeoutMs as number) > 3_600_000)) return false
  return true
}
