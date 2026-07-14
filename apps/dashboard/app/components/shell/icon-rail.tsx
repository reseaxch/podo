"use client"

import type { IncidentTab } from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

type IconRailProps = {
  onTabChange: (tab: IncidentTab) => void
  onNotify: (message: string) => void
}

export function IconRail({ onTabChange, onNotify }: IconRailProps) {
  return (
    <aside className="icon-rail" aria-label="Primary navigation">
      <a className="brand-mark" aria-label="Podo home" href="#workspace">
        <Icon name="cube" size={21} />
      </a>
      <nav>
        <a aria-label="Overview" href="#workspace">
          <Icon name="squares-four" />
        </a>
        <a
          aria-current="page"
          aria-label="Incidents"
          className="active"
          href="#workspace"
        >
          <Icon name="trend-up" />
        </a>
        <button
          aria-label="Evidence sources"
          onClick={() => {
            onTabChange("evidence")
            onNotify("7 evidence sources connected")
          }}
          type="button"
        >
          <Icon name="database" />
        </button>
        <button
          aria-label="System graph"
          onClick={() => onTabChange("graph")}
          type="button"
        >
          <Icon name="git-fork" />
        </button>
        <button
          aria-label="Safety"
          onClick={() => onNotify("Production mutations are blocked")}
          type="button"
        >
          <Icon name="shield-check" />
        </button>
        <button
          aria-label="Audit log"
          onClick={() => onNotify("Audit log contains 18 events")}
          type="button"
        >
          <Icon name="file-text" />
        </button>
        <button
          aria-label="Settings"
          onClick={() => onNotify("Workspace settings opened")}
          type="button"
        >
          <Icon name="gear-six" />
        </button>
      </nav>
      <div className="rail-bottom">
        <button
          aria-label="Help"
          onClick={() => onNotify("Incident workspace help opened")}
          type="button"
        >
          <Icon name="question" />
        </button>
        <button
          aria-label="Open command line"
          onClick={() =>
            onNotify("Command line is available in the desktop app")
          }
          type="button"
        >
          <Icon name="terminal-window" />
        </button>
      </div>
    </aside>
  )
}
