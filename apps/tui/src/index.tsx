import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { ConnectedPodoTui } from "./connected"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

createRoot(renderer).render(
  <ConnectedPodoTui coreUrl={process.env.PODO_CORE_URL ?? "http://127.0.0.1:4100"} />,
)
