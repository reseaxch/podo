"use client"

import { Icon } from "./ui/pictogram"

export function OperationalPageError({ reset }: { reset: () => void }) {
  return (
    <main className="page-state">
      <span className="page-state-icon error">
        <Icon name="warning-circle" size={24} />
      </span>
      <h1>Core data unavailable</h1>
      <p>
        Podo could not load authoritative data. No demo fixtures were
        substituted.
      </p>
      <button className="primary-button" onClick={reset} type="button">
        Try again
      </button>
    </main>
  )
}
