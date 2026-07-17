import { isDemoDashboard } from "./dashboard-client"

export type DashboardShellContext = {
  owner: { name: string; avatar: string }
  source: "demo" | "core"
}

export function getDashboardShellContext(): DashboardShellContext {
  return isDemoDashboard()
    ? {
        owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
        source: "demo",
      }
    : {
        owner: { name: "Podo Core", avatar: "/icon.svg" },
        source: "core",
      }
}
