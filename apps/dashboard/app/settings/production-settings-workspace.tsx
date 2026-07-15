"use client"

import type { PodoSettings } from "@podo/contracts"
import { useState } from "react"

import { IconRail } from "../components/shell/icon-rail"
import { Topbar } from "../components/shell/topbar"

export function ProductionSettingsWorkspace({
  initial,
}: {
  initial: PodoSettings
}) {
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const response = await fetch("/api/podo/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      const result = (await response.json()) as
        { settings: PodoSettings } | { message?: string }
      if (!response.ok)
        throw new Error(
          "message" in result && result.message
            ? result.message
            : `Save failed (${response.status})`,
        )
      const next = (result as { settings: PodoSettings }).settings
      setSaved(next)
      setDraft(next)
      setStatus("Core settings saved.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Settings unavailable")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="app-shell" data-ready="true">
      <IconRail />
      <Topbar
        current="Settings"
        onNotify={setStatus}
        onQueryChange={() => undefined}
        owner={{ name: "Podo Core", avatar: "/icon.svg" }}
        query=""
        searchLabel="Search settings"
        searchPlaceholder="Core settings"
        section="Settings"
      />
      <section className="core-settings-page">
        <header>
          <span className="eyebrow">Authoritative Core configuration</span>
          <h1>Settings</h1>
          <p>Only settings owned by Core are editable here.</p>
        </header>
        <section
          className="core-settings-card"
          aria-labelledby="core-policy-title"
        >
          <h2 id="core-policy-title">Investigation and safety policy</h2>
          <label>
            <span>Autonomy mode</span>
            <select
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autonomyMode: event.target
                    .value as PodoSettings["autonomyMode"],
                })
              }
              value={draft.autonomyMode}
            >
              <option value="observe">Observe</option>
              <option value="recommend">Recommend</option>
              <option value="act_with_approval">Act with approval</option>
            </select>
          </label>
          <label>
            <span>Default sandbox</span>
            <select
              onChange={(event) =>
                setDraft({
                  ...draft,
                  defaultSandbox: event.target
                    .value as PodoSettings["defaultSandbox"],
                })
              }
              value={draft.defaultSandbox}
            >
              <option value="read-only">Read only</option>
              <option value="workspace-write">Workspace write</option>
            </select>
          </label>
          <label>
            <span>Turn timeout (milliseconds)</span>
            <input
              min={1000}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  turnTimeoutMs: Number(event.target.value),
                })
              }
              type="number"
              value={draft.turnTimeoutMs}
            />
          </label>
          <label className="core-settings-checkbox">
            <input
              checked={draft.monitoringEnabled}
              onChange={(event) =>
                setDraft({ ...draft, monitoringEnabled: event.target.checked })
              }
              type="checkbox"
            />
            <span>Monitoring enabled</span>
          </label>
          {status ? <p role="status">{status}</p> : null}
          <footer>
            <button
              className="secondary-button"
              disabled={!dirty || saving}
              onClick={() => setDraft(saved)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </section>
      </section>
    </main>
  )
}
