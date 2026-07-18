"use client"

import { useState } from "react"

import type {
  IncidentGraphNodeViewModel,
  IncidentGraphViewModel,
} from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

const paths = [
  "M128 178 C182 178 188 93 252 93",
  "M353 93 C408 93 405 93 456 93",
  "M353 93 C405 93 408 253 456 253",
  "M559 93 C620 93 620 178 674 178",
  "M559 253 C620 253 620 178 674 178",
] as const

const slotClasses: Record<IncidentGraphNodeViewModel["slot"], string> = {
  trigger: "deploy",
  signal: "heap",
  impact: "trace",
  runtime: "gc",
  cause: "code",
}

const slotIcons: Record<
  IncidentGraphNodeViewModel["slot"],
  "activity" | "chart-line-up" | "code" | "cube" | "git-fork"
> = {
  trigger: "cube",
  signal: "chart-line-up",
  impact: "git-fork",
  runtime: "activity",
  cause: "code",
}

export function CoreGraphView({
  graph,
  onOpenEvidence,
}: {
  graph: IncidentGraphViewModel
  onOpenEvidence: (evidenceId: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null

  return (
    <section className="graph-view" aria-labelledby="graph-heading">
      <div className="view-heading">
        <div>
          <p className="view-kicker">Core-owned causal graph</p>
          <h2 id="graph-heading">Evidence to affected code</h2>
          <p>
            Every visible node comes from the incident, normalized telemetry, or
            the trusted code graph.
          </p>
        </div>
        <div className="view-actions">
          <span className="graph-health">
            <i /> Live core data
          </span>
        </div>
      </div>
      <div className="graph-workspace">
        <div className="graph-toolbar">
          <span>
            <strong>Incident subgraph</strong>
            <small>{graph.nodes.length} authoritative nodes</small>
          </span>
        </div>
        <div
          aria-label="Core causal graph from telemetry to affected code"
          className="causal-canvas graph-mode-causal"
        >
          <div className="graph-scene">
            <svg
              aria-hidden="true"
              className="graph-edges"
              preserveAspectRatio="none"
              viewBox="0 0 760 350"
            >
              {paths.map((path) => (
                <path d={path} key={`track-${path}`} />
              ))}
              {paths.map((path) => (
                <path
                  className="graph-edge-flow"
                  d={path}
                  key={`flow-${path}`}
                  pathLength="1"
                />
              ))}
            </svg>
            {graph.nodes.map((node) => (
              <button
                aria-pressed={selectedId === node.id}
                className={`graph-node graph-node-causal ${
                  node.slot === "cause"
                    ? "root-cause graph-node-root graph-node-critical"
                    : node.slot === "trigger"
                      ? "graph-node-changed"
                      : "graph-node-degraded"
                } node-${slotClasses[node.slot]}`}
                key={node.id}
                onClick={() => setSelectedId(node.id)}
                type="button"
              >
                <span className="graph-node-icon">
                  <Icon name={slotIcons[node.slot]} size={18} />
                </span>
                <span>
                  <small>{node.kind}</small>
                  <strong>{node.title}</strong>
                  <em>{node.subtitle}</em>
                </span>
              </button>
            ))}
          </div>
        </div>
        {selected ? (
          <section
            aria-live="polite"
            className="graph-inspector"
            key={selected.id}
          >
            <header>
              <span>
                <small>{selected.kind}</small>
                <strong>{selected.title}</strong>
                <em>{selected.status}</em>
              </span>
              <button
                aria-label="Close node details"
                onClick={() => setSelectedId(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div>
              <small>Why it matters</small>
              <p>{selected.why}</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => onOpenEvidence(selected.evidenceId)}
              type="button"
            >
              Open evidence <Icon name="arrow-square-out" size={14} />
            </button>
          </section>
        ) : null}
        <div className="graph-proof-row" aria-label="Causal proof summary">
          {graph.nodes
            .filter(
              (node) =>
                node.slot === "trigger" ||
                node.slot === "signal" ||
                node.slot === "cause",
            )
            .map((node, index) => (
              <span key={node.id}>
                <small>{node.kind}</small>
                <strong>{node.title}</strong>
                <em>{node.status}</em>
                {index < 2 ? <b aria-hidden="true">→</b> : null}
              </span>
            ))}
        </div>
        <footer className="graph-legend">
          <span>
            <i className="legend-causal" /> Core evidence
          </span>
          <span>
            <i className="legend-root" /> Affected code
          </span>
          {graph.confidencePercent === undefined ? null : (
            <strong>Confidence {graph.confidencePercent}%</strong>
          )}
        </footer>
      </div>
    </section>
  )
}
