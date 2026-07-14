"use client"

type IncidentPageStateProps =
  | { kind: "loading"; onRetry?: never }
  | { kind: "empty"; onRetry?: never }
  | { kind: "error"; onRetry: () => void }

const content = {
  loading: {
    title: "Loading incident workspace",
    description: "Correlating deployment, runtime, trace, and code evidence.",
  },
  empty: {
    title: "Incident not found",
    description:
      "This incident may have been resolved, moved, or you may not have access.",
  },
  error: {
    title: "Incident unavailable",
    description:
      "Podo could not load the incident evidence. Your workspace state is safe.",
  },
} as const

export function IncidentPageState(props: IncidentPageStateProps) {
  const state = content[props.kind]

  return (
    <main
      aria-busy={props.kind === "loading"}
      className={`page-state page-state-${props.kind}`}
    >
      <div className="page-state-card">
        <span aria-hidden="true" className="page-state-mark" />
        <h1>{state.title}</h1>
        <p>{state.description}</p>
        {props.kind === "error" ? (
          <button
            className="primary-button"
            onClick={props.onRetry}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </div>
    </main>
  )
}
