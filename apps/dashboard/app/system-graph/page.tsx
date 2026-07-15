import type { Metadata } from "next"

import { SystemGraphWorkspace } from "./system-graph-workspace"
import { getSystemGraph } from "./system-graph-data"

export default async function SystemGraphPage() {
  const graph = await getSystemGraph()
  return <SystemGraphWorkspace graph={graph} />
}
export const metadata: Metadata = { title: "System graph | Podo" }
