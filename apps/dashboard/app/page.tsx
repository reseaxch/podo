const workstreams = [
  ["Core", "Incident lifecycle, evidence, approvals, and audit"],
  ["Codex runtime", "App-server protocol, supervision, and sandbox execution"],
  ["Clients", "CLI, OpenTUI, and dashboard surfaces"],
  ["Plugins", "Graphify, telemetry replay, and GitHub capabilities"],
  ["Quality", "Scenarios, evals, benchmarks, and tests"],
] as const

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">OpenAI Build Week 2026 · Developer Tools</p>
        <h1>Rootline</h1>
        <p className="lede">
          Trace an incident from infrastructure evidence to the responsible code change, then produce a tested,
          approval-gated fix with Codex.
        </p>
        <div className="flow" aria-label="Rootline MVP flow">
          incident <span>→</span> evidence <span>→</span> root cause <span>→</span> tested fix <span>→</span> pull request
        </div>
      </section>

      <section aria-labelledby="workstreams-title">
        <div className="section-heading">
          <p className="eyebrow">Repository foundation</p>
          <h2 id="workstreams-title">Parallel workstreams, one contract</h2>
        </div>
        <div className="grid">
          {workstreams.map(([name, description]) => (
            <article className="card" key={name}>
              <h3>{name}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
