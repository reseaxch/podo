"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Icon } from "../ui/pictogram"
import { ShellOverlay, type ShellOverlayMode } from "./shell-overlay"

export function IconRail() {
  const [overlay, setOverlay] = useState<ShellOverlayMode | null>(null)
  const pathname = usePathname() ?? ""
  const overviewActive = pathname.startsWith("/overview")
  const incidentsActive =
    pathname === "/" ||
    pathname === "/demo" ||
    pathname.startsWith("/incidents")
  const auditActive = pathname.startsWith("/audit")
  const evidenceActive = pathname.startsWith("/evidence-sources")
  const graphActive = pathname.startsWith("/system-graph")
  const safetyActive = pathname.startsWith("/safety")
  const settingsActive = pathname.startsWith("/settings")

  const closeOverlay = useCallback(() => setOverlay(null), [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault()
        setOverlay("command")
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  return (
    <>
      <aside className="icon-rail" aria-label="Primary navigation">
        <Link className="brand-mark" aria-label="Podo home" href="/overview">
          <Icon name="cube" size={21} />
        </Link>
        <nav>
          <Link
            aria-current={overviewActive ? "page" : undefined}
            aria-label="Overview"
            className={overviewActive ? "active" : undefined}
            href="/overview"
          >
            <span className="rail-icon">
              <Icon name="squares-four" />
            </span>
            <span className="rail-label">Overview</span>
          </Link>
          <Link
            aria-current={incidentsActive ? "page" : undefined}
            aria-label="Incidents"
            className={incidentsActive ? "active" : undefined}
            href="/incidents"
          >
            <span className="rail-icon">
              <Icon name="trend-up" />
            </span>
            <span className="rail-label">Incidents</span>
          </Link>
          <Link
            aria-current={evidenceActive ? "page" : undefined}
            aria-label="Evidence sources"
            className={evidenceActive ? "active" : undefined}
            href="/evidence-sources"
          >
            <span className="rail-icon">
              <Icon name="database" />
            </span>
            <span className="rail-label">Evidence sources</span>
          </Link>
          <Link
            aria-current={graphActive ? "page" : undefined}
            aria-label="System graph"
            className={graphActive ? "active" : undefined}
            href="/system-graph"
          >
            <span className="rail-icon">
              <Icon name="git-fork" />
            </span>
            <span className="rail-label">System graph</span>
          </Link>
          <Link
            aria-current={safetyActive ? "page" : undefined}
            aria-label="Safety"
            className={safetyActive ? "active" : undefined}
            href="/safety"
          >
            <span className="rail-icon">
              <Icon name="shield-check" />
            </span>
            <span className="rail-label">Safety & approvals</span>
          </Link>
          <Link
            aria-current={auditActive ? "page" : undefined}
            aria-label="Audit log"
            className={auditActive ? "active" : undefined}
            href="/audit"
          >
            <span className="rail-icon">
              <Icon name="file-text" />
            </span>
            <span className="rail-label">Audit log</span>
          </Link>
          <Link
            aria-current={settingsActive ? "page" : undefined}
            aria-label="Settings"
            className={settingsActive ? "active" : undefined}
            href="/settings"
          >
            <span className="rail-icon">
              <Icon name="gear-six" />
            </span>
            <span className="rail-label">Settings</span>
          </Link>
        </nav>
        <div className="rail-bottom">
          <button
            aria-label="Help"
            onClick={() => setOverlay("help")}
            type="button"
          >
            <span className="rail-icon">
              <Icon name="question" />
            </span>
            <span className="rail-label">Help</span>
          </button>
          <button
            aria-label="Open command line"
            onClick={() => setOverlay("command")}
            type="button"
          >
            <span className="rail-icon">
              <Icon name="terminal-window" />
            </span>
            <span className="rail-label">Command line</span>
          </button>
        </div>
      </aside>
      {overlay ? (
        <ShellOverlay
          key={overlay}
          mode={overlay}
          onClose={closeOverlay}
          onModeChange={setOverlay}
        />
      ) : null}
    </>
  )
}
