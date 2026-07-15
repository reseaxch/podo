"use client"

export default function AuditError({ reset }: { reset: () => void }) {
  return (
    <main className="page-state" aria-label="Audit log unavailable">
      <div className="state-card error-card">
        <strong>Audit log unavailable</strong>
        <p>
          The event stream could not be verified. No partial audit data is
          shown.
        </p>
        <button onClick={reset} type="button">
          Retry
        </button>
      </div>
    </main>
  )
}
