"use client"

import { Icon } from "../components/ui/pictogram"

export default function EvidenceSourcesError({ reset }: { reset: () => void }) {
  return (
    <main className="page-state page-state-error">
      <section className="page-state-card" role="alert">
        <Icon name="warning-circle" size={28} />
        <h1>Evidence sources could not be loaded</h1>
        <p>
          The connector catalog is temporarily unavailable. Existing evidence
          remains attached to incidents.
        </p>
        <button className="secondary-button" onClick={reset} type="button">
          Try again
        </button>
      </section>
    </main>
  )
}
