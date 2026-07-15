import { getWorkspaceSettings } from "./settings-model"
import { SettingsWorkspace } from "./settings-workspace"

export default function SettingsPage() {
  const view = getWorkspaceSettings()
  return <SettingsWorkspace view={view} />
}
