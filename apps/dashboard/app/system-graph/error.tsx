"use client"

export default function SystemGraphError({ reset }: { reset: () => void }) {
  return (
    <main className="page-state page-state-error">
      <div className="page-state-card" role="alert">
        <span aria-hidden="true" className="page-state-mark" />
        <h1>System graph unavailable</h1>
        <p>
          No partial topology is shown because its evidence could not be
          verified.
        </p>
        <button className="primary-button" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </main>
  )
}
