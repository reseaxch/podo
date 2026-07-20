export default function BuildIncidentsLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading build incidents"
      className="build-loading-page"
    >
      <header className="build-loading-heading">
        <i className="build-skeleton build-skeleton-eyebrow" />
        <h1>Build incidents</h1>
        <i className="build-skeleton build-skeleton-copy" />
      </header>
      <section aria-hidden="true" className="build-loading-summary">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index}>
            <i className="build-skeleton build-skeleton-label" />
            <i className="build-skeleton build-skeleton-number" />
            <i className="build-skeleton build-skeleton-copy" />
          </span>
        ))}
      </section>
      <section aria-hidden="true" className="build-loading-workspace">
        <div className="build-loading-queue">
          <i className="build-skeleton build-skeleton-label" />
          <i className="build-skeleton build-skeleton-title" />
          <div className="build-loading-row">
            <i className="build-skeleton build-skeleton-pill" />
            <i className="build-skeleton build-skeleton-title" />
            <i className="build-skeleton build-skeleton-copy" />
          </div>
        </div>
        <aside className="build-loading-action">
          <i className="build-skeleton build-skeleton-label" />
          <i className="build-skeleton build-skeleton-title" />
          <i className="build-skeleton build-skeleton-pill" />
          <i className="build-skeleton build-skeleton-copy" />
          <i className="build-skeleton build-skeleton-copy" />
        </aside>
      </section>
    </main>
  )
}
