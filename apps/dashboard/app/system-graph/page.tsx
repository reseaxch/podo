import type { Metadata } from "next"

import { SystemGraphWorkspace } from "./system-graph-workspace"
import { getSystemGraph } from "./system-graph-data"
import { isDemoDashboard } from "../lib/dashboard-client"

export default async function SystemGraphPage() {
  const graph = await getSystemGraph()
  return (
    <SystemGraphWorkspace
      graph={graph}
      source={isDemoDashboard() ? "demo" : "core"}
    />
  )
}
export const metadata: Metadata = { title: "System graph | Podo" }
