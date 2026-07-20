import type { Metadata } from "next"

import { getWorkspaceSettings } from "./settings-model"
import { SettingsWorkspace } from "./settings-workspace"
import { ProductionSettingsWorkspace } from "./production-settings-workspace"
import {
  createDashboardClient,
  isDemoDashboard,
  isTrustedOperatorMode,
} from "../lib/dashboard-client"

export default async function SettingsPage() {
  if (isDemoDashboard())
    return <SettingsWorkspace view={getWorkspaceSettings()} />
  const { settings } = await createDashboardClient().getSettings()
  return (
    <ProductionSettingsWorkspace
      initial={settings}
      mutationsEnabled={isTrustedOperatorMode()}
    />
  )
}
export const metadata: Metadata = { title: "Settings | Podo" }
