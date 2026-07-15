import { SystemGraphWorkspace } from "./system-graph-workspace"
import { getSystemGraph } from "./system-graph-data"

export default function SystemGraphPage() {
  const graph = getSystemGraph()
  return <SystemGraphWorkspace graph={graph} />
}
