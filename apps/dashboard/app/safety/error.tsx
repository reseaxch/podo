"use client"

export default function SafetyError({ reset }: { reset: () => void }) {
  return (
    <main className="page-state page-state-error">
      <div className="page-state-card" role="alert">
        <span aria-hidden="true" className="page-state-mark" />
        <h1>Approval queue unavailable</h1>
        <p>No action can be approved while policy state is unavailable.</p>
        <button className="primary-button" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </main>
  )
}
