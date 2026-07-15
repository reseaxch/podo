"use client"

export default function SettingsError({ reset }: { reset: () => void }) {
  return (
    <main className="page-state page-state-error">
      <div className="page-state-card" role="alert">
        <span aria-hidden="true" className="page-state-mark" />
        <h1>Workspace settings unavailable</h1>
        <p>
          No configuration changes can be saved until the current revision
          loads.
        </p>
        <button className="primary-button" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </main>
  )
}
