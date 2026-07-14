import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { RootlineTui } from "./app"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

createRoot(renderer).render(
  <RootlineTui coreUrl={process.env.ROOTLINE_CORE_URL ?? "http://127.0.0.1:4100"} />,
)
