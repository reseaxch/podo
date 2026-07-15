import type { Metadata } from "next"

import { getWorkspaceSettings } from "./settings-model"
import { SettingsWorkspace } from "./settings-workspace"
import { ProductionSettingsWorkspace } from "./production-settings-workspace"
import { createDashboardClient, isDemoDashboard } from "../lib/dashboard-client"

export default async function SettingsPage() {
  if (isDemoDashboard())
    return <SettingsWorkspace view={getWorkspaceSettings()} />
  const { settings } = await createDashboardClient().getSettings()
  return <ProductionSettingsWorkspace initial={settings} />
}
export const metadata: Metadata = { title: "Settings | Podo" }
