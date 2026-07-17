"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { AgentPanel } from "../agent/agent-panel"
import { Icon } from "../ui/pictogram"
import { ShellOverlay, type ShellOverlayMode } from "./shell-overlay"

export function IconRail() {
  const [overlay, setOverlay] = useState<ShellOverlayMode | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [mobileNavigationClosing, setMobileNavigationClosing] = useState(false)
  const mobileDialogRef = useRef<HTMLDivElement | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const agentTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mobileCloseTimerRef = useRef<number | null>(null)
  const pathname = usePathname() ?? ""
  const overviewActive = pathname.startsWith("/overview")
  const incidentsActive =
    pathname === "/" ||
    pathname === "/demo" ||
    pathname.startsWith("/incidents")
  const buildIncidentsActive = pathname.startsWith("/build-incidents")
  const auditActive = pathname.startsWith("/audit")
  const evidenceActive = pathname.startsWith("/evidence-sources")
  const graphActive = pathname.startsWith("/system-graph")
  const safetyActive = pathname.startsWith("/safety")
  const settingsActive = pathname.startsWith("/settings")

  const closeOverlay = useCallback(() => setOverlay(null), [])
  const closeAgent = useCallback(() => {
    setAgentOpen(false)
    window.setTimeout(() => agentTriggerRef.current?.focus(), 0)
  }, [])
  const closeMobileNavigation = useCallback((restoreFocus = true) => {
    if (restoreFocus) mobileTriggerRef.current?.focus()
    setMobileNavigationClosing(true)
    mobileCloseTimerRef.current = window.setTimeout(() => {
      setMobileNavigationOpen(false)
      setMobileNavigationClosing(false)
      mobileCloseTimerRef.current = null
    }, 150)
  }, [])

  useEffect(
    () => () => {
      if (mobileCloseTimerRef.current !== null)
        window.clearTimeout(mobileCloseTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!mobileNavigationOpen) return
    const dialog = mobileDialogRef.current
    if (!dialog) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    focusable[0]?.focus()

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeMobileNavigation()
        return
      }
      if (event.key !== "Tab" || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    dialog.addEventListener("keydown", handleDialogKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      dialog.removeEventListener("keydown", handleDialogKeyDown)
    }
  }, [closeMobileNavigation, mobileNavigationOpen])

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
          <div aria-label="Operations" className="rail-section" role="group">
            <span aria-hidden="true" className="rail-section-label">
              Operations
            </span>
            <div className="rail-section-links">
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
                aria-current={buildIncidentsActive ? "page" : undefined}
                aria-label="Build incidents"
                className={buildIncidentsActive ? "active" : undefined}
                href="/build-incidents"
              >
                <span className="rail-icon">
                  <Icon name="wrench" />
                </span>
                <span className="rail-label">Build incidents</span>
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
            </div>
          </div>
          <span aria-hidden="true" className="rail-section-divider" />
          <div aria-label="Governance" className="rail-section" role="group">
            <span aria-hidden="true" className="rail-section-label">
              Governance
            </span>
            <div className="rail-section-links">
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
            </div>
          </div>
          <span aria-hidden="true" className="rail-section-divider" />
          <div className="rail-section rail-settings">
            <div className="rail-section-links">
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
            </div>
          </div>
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
      <button
        aria-controls="mobile-primary-navigation"
        aria-expanded={mobileNavigationOpen && !mobileNavigationClosing}
        aria-label="Open primary navigation"
        className="mobile-nav-trigger"
        onClick={() => {
          setMobileNavigationClosing(false)
          setMobileNavigationOpen(true)
        }}
        ref={mobileTriggerRef}
        type="button"
      >
        <Icon name="squares-four" size={19} />
      </button>
      {mobileNavigationOpen ? (
        <>
          <button
            aria-label="Close primary navigation"
            className="mobile-nav-backdrop"
            data-motion-state={mobileNavigationClosing ? "exiting" : "visible"}
            onClick={() => closeMobileNavigation()}
            type="button"
          />
          <div
            aria-label="Primary navigation"
            aria-modal="true"
            className="mobile-nav-dialog"
            data-motion-state={mobileNavigationClosing ? "exiting" : "visible"}
            id="mobile-primary-navigation"
            ref={mobileDialogRef}
            role="dialog"
          >
            <header>
              <span>
                <Icon name="cube" size={18} />
                <strong>Navigate Podo</strong>
              </span>
              <button
                aria-label="Close primary navigation"
                onClick={() => closeMobileNavigation()}
                type="button"
              >
                <Icon name="x" size={17} />
              </button>
            </header>
            <nav aria-label="Mobile primary navigation">
              <button
                className="mobile-agent-trigger"
                onClick={() => {
                  setMobileNavigationOpen(false)
                  setMobileNavigationClosing(false)
                  setOverlay(null)
                  setAgentOpen(true)
                }}
                type="button"
              >
                <Icon name="robot" /> Ask Podo Agent
              </button>
              <Link
                aria-current={overviewActive ? "page" : undefined}
                className={overviewActive ? "active" : undefined}
                href="/overview"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="squares-four" /> Overview
              </Link>
              <Link
                aria-current={incidentsActive ? "page" : undefined}
                className={incidentsActive ? "active" : undefined}
                href="/incidents"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="trend-up" /> Incidents
              </Link>
              <Link
                aria-current={buildIncidentsActive ? "page" : undefined}
                className={buildIncidentsActive ? "active" : undefined}
                href="/build-incidents"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="wrench" /> Build incidents
              </Link>
              <Link
                aria-current={evidenceActive ? "page" : undefined}
                className={evidenceActive ? "active" : undefined}
                href="/evidence-sources"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="database" /> Evidence sources
              </Link>
              <Link
                aria-current={graphActive ? "page" : undefined}
                className={graphActive ? "active" : undefined}
                href="/system-graph"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="git-fork" /> System graph
              </Link>
              <Link
                aria-current={safetyActive ? "page" : undefined}
                className={safetyActive ? "active" : undefined}
                href="/safety"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="shield-check" /> Safety & approvals
              </Link>
              <Link
                aria-current={auditActive ? "page" : undefined}
                className={auditActive ? "active" : undefined}
                href="/audit"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="file-text" /> Audit log
              </Link>
              <Link
                aria-current={settingsActive ? "page" : undefined}
                className={settingsActive ? "active" : undefined}
                href="/settings"
                onClick={() => closeMobileNavigation(false)}
              >
                <Icon name="gear-six" /> Settings
              </Link>
            </nav>
          </div>
        </>
      ) : null}
      {overlay ? (
        <ShellOverlay
          key={overlay}
          mode={overlay}
          onClose={closeOverlay}
          onModeChange={setOverlay}
        />
      ) : null}
      {!agentOpen ? (
        <button
          aria-label="Open Podo Agent"
          className="agent-floating-trigger"
          onClick={() => {
            setOverlay(null)
            setAgentOpen(true)
          }}
          ref={agentTriggerRef}
          type="button"
        >
          <Icon name="robot" size={25} />
          <i aria-hidden="true" />
        </button>
      ) : null}
      {agentOpen ? (
        <AgentPanel
          onClose={closeAgent}
          projectLabel="podo-cloud"
          projectScope="All project evidence"
        />
      ) : null}
    </>
  )
}
