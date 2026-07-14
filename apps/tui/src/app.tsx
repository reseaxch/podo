import { useKeyboard, useRenderer } from "@opentui/react"

export interface RootlineTuiProps {
  coreUrl: string
}

export function RootlineTui({ coreUrl }: RootlineTuiProps) {
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      renderer.destroy()
    }
  })

  return (
    <box style={{ flexDirection: "column", gap: 1, padding: 1 }}>
      <box title="Rootline" style={{ border: true, padding: 1, flexDirection: "column", gap: 1 }}>
        <text fg="#7dd3fc">incident → evidence → root cause → tested fix → pull request</text>
        <text>Core: {coreUrl}</text>
        <text fg="#94a3b8">Foundation shell — press q or Esc to exit.</text>
      </box>
    </box>
  )
}
