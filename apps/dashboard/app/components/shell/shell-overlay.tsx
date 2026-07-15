"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"

import type { IconName } from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

export type ShellOverlayMode = "help" | "command"

type ShellOverlayProps = {
  mode: ShellOverlayMode
  onClose: () => void
  onModeChange: (mode: ShellOverlayMode) => void
}

const commands: Array<{
  label: string
  description: string
  href: string
  icon: IconName
  keywords: string
}> = [
  {
    label: "Open overview",
    description: "Review decisions, posture, and active work",
    href: "/overview",
    icon: "squares-four",
    keywords: "home command center decisions posture",
  },
  {
    label: "Open incidents",
    description: "Review active investigations and ownership",
    href: "/incidents",
    icon: "trend-up",
    keywords: "queue active incidents registry",
  },
  {
    label: "Open system graph",
    description: "Explore services, dependencies, and changes",
    href: "/system-graph",
    icon: "git-fork",
    keywords: "topology services graph dependencies",
  },
  {
    label: "Open evidence sources",
    description: "Inspect connected telemetry and source health",
    href: "/evidence-sources",
    icon: "database",
    keywords: "datadog github telemetry evidence connectors",
  },
  {
    label: "Review safety approvals",
    description: "Approve or deny bounded agent actions",
    href: "/safety",
    icon: "shield-check",
    keywords: "policy pending approve deny safety",
  },
  {
    label: "Open audit log",
    description: "Trace immutable agent and human decisions",
    href: "/audit",
    icon: "file-text",
    keywords: "history events audit decisions",
  },
  {
    label: "Open settings",
    description: "Configure workspace integrations and policy",
    href: "/settings",
    icon: "gear-six",
    keywords: "workspace team repositories configuration",
  },
]

export function ShellOverlay({
  mode,
  onClose,
  onModeChange,
}: ShellOverlayProps) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredCommands = useMemo(
    () =>
      commands.filter((command) =>
        `${command.label} ${command.description} ${command.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [normalizedQuery],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (mode === "command") inputRef.current?.focus()
  }, [mode])

  return (
    <div
      className="shell-overlay-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label={mode === "command" ? "Command line" : "Podo help"}
        aria-modal="true"
        className="shell-overlay"
        role="dialog"
      >
        <header className="shell-overlay-header">
          <span className="shell-overlay-icon">
            <Icon
              name={mode === "command" ? "terminal-window" : "question"}
              size={19}
            />
          </span>
          <div>
            <small>{mode === "command" ? "Quick navigation" : "Help"}</small>
            <h2>{mode === "command" ? "Command line" : "How can we help?"}</h2>
          </div>
          <button aria-label="Close" onClick={onClose} type="button">
            <Icon name="x" size={16} />
          </button>
        </header>

        {mode === "command" ? (
          <>
            <label className="shell-command-input">
              <Icon name="magnifying-glass" size={17} />
              <input
                aria-label="Search commands"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages and actions..."
                ref={inputRef}
                type="search"
                value={query}
              />
              <kbd>ESC</kbd>
            </label>
            <div className="shell-command-list" role="list">
              {filteredCommands.map((command) => (
                <Link href={command.href} key={command.href} onClick={onClose}>
                  <span>
                    <Icon name={command.icon} size={17} />
                  </span>
                  <span>
                    <strong>{command.label}</strong>
                    <small>{command.description}</small>
                  </span>
                  <Icon name="caret-right" size={15} />
                </Link>
              ))}
              {!filteredCommands.length ? (
                <div className="shell-command-empty">
                  <Icon name="magnifying-glass" size={19} />
                  <strong>No matching commands</strong>
                  <small>Try “graph”, “audit”, or “settings”.</small>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="shell-help-content">
            <div className="shell-help-intro">
              <span className="shell-overlay-icon">
                <Icon name="shield-check" size={18} />
              </span>
              <span>
                <strong>Podo stays bounded by default</strong>
                <small>
                  Evidence is read-only until a human explicitly approves a
                  scoped action.
                </small>
              </span>
            </div>
            <div className="shell-help-links">
              <Link href="/incidents" onClick={onClose}>
                <span>
                  <strong>Investigate an incident</strong>
                  <small>Start from prioritized evidence and diagnosis.</small>
                </span>
                <Icon name="caret-right" size={15} />
              </Link>
              <Link href="/system-graph" onClick={onClose}>
                <span>
                  <strong>Understand the system graph</strong>
                  <small>Follow runtime pressure back to code changes.</small>
                </span>
                <Icon name="caret-right" size={15} />
              </Link>
              <Link href="/safety" onClick={onClose}>
                <span>
                  <strong>Review an approval</strong>
                  <small>Check scope, policy, and supporting evidence.</small>
                </span>
                <Icon name="caret-right" size={15} />
              </Link>
            </div>
            <div className="shell-shortcuts">
              <span>
                <kbd>⌘ K</kbd>
                <small>Focus page search</small>
              </span>
              <span>
                <kbd>⌘ ⇧ K</kbd>
                <small>Open command line</small>
              </span>
              <span>
                <kbd>ESC</kbd>
                <small>Close dialogs</small>
              </span>
            </div>
            <button
              className="shell-help-command"
              onClick={() => onModeChange("command")}
              type="button"
            >
              <Icon name="terminal-window" size={16} /> Open command line
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
