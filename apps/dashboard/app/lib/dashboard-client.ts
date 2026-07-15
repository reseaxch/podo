import { createPodoClient } from "@podo/client"

export function createDashboardClient() {
  return createPodoClient({
    baseUrl: process.env.PODO_CORE_URL ?? "http://127.0.0.1:4100",
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  })
}

export function isDemoDashboard() {
  return process.env.PODO_DASHBOARD_MODE === "demo"
}

export function incidentWorkingDirectory() {
  return process.env.PODO_INCIDENT_CWD ?? process.cwd()
}
