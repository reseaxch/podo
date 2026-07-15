import type { Evidence } from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

function TrendChart() {
  return (
    <svg
      aria-label="Latency and heap usage increase after the deployment"
      className="trend-chart"
      role="img"
      viewBox="0 0 420 160"
    >
      <title>Latency and heap usage increase after the deployment</title>
      <g className="chart-grid">
        <path d="M38 18H392M38 49H392M38 80H392M38 111H392" />
      </g>
      <g className="chart-axis-labels">
        <text x="4" y="22">
          1600
        </text>
        <text x="10" y="53">
          1200
        </text>
        <text x="16" y="84">
          800
        </text>
        <text x="16" y="115">
          400
        </text>
        <text x="35" y="139">
          09:50
        </text>
        <text x="132" y="139">
          10:00
        </text>
        <text x="229" y="139">
          10:10
        </text>
        <text x="346" y="139">
          10:25
        </text>
      </g>
      <path className="chart-deploy-line" d="M188 14V116" />
      <text className="chart-deploy-label" x="194" y="25">
        deploy
      </text>
      <polyline
        className="chart-line latency"
        points="38,98 88,96 138,94 188,91 238,52 288,57 338,51 388,54"
      />
      <polyline
        className="chart-line heap"
        points="38,82 88,79 138,75 188,52 238,21 288,21 338,20 388,21"
      />
      <g className="chart-legend">
        <path className="chart-line latency" d="M112 153H132" />
        <text x="138" y="156">
          Latency (p95)
        </text>
        <path className="chart-line heap" d="M245 153H265" />
        <text x="271" y="156">
          Heap (%)
        </text>
      </g>
    </svg>
  )
}

function CodeLocation() {
  return (
    <section className="code-location" aria-labelledby="code-location-title">
      <div className="code-location-header">
        <div>
          <strong id="code-location-title">Code location</strong>
          <span>services/checkout/cache.ts:47</span>
        </div>
        <button
          aria-label="Open code location"
          className="icon-button compact"
          type="button"
        >
          <Icon name="arrow-square-out" size={15} />
        </button>
      </div>
      <pre aria-label="Code excerpt">
        <code>
          <span>
            <b>45</b>
            <i>const</i> key = {"`cart:${userId}:${JSON.stringify(items)}`;"}
          </span>
          <span>
            <b>46</b>
          </span>
          <span className="highlight">
            <b>47</b>CheckoutCache.set(key, payload, {`{ ttl: 60 }`});
          </span>
          <span>
            <b>48</b>
            <i>return</i> payload;
          </span>
          <span>
            <b>49</b>
            {"}"}
          </span>
        </code>
      </pre>
    </section>
  )
}

function DetailFacts({
  facts,
}: {
  facts: readonly [string, string, string][]
}) {
  return (
    <dl className="detail-facts">
      {facts.map(([label, value, note]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
          <small>{note}</small>
        </div>
      ))}
    </dl>
  )
}

function EvidenceDetail({ item }: { item: Evidence }) {
  if (item.id === "deploy")
    return (
      <div className="evidence-detail detail-stack">
        <div className="detail-heading">
          <span className="detail-kicker">Deployment context</span>
          <strong>Release v2.8.1 introduced the first correlated change</strong>
        </div>
        <DetailFacts
          facts={[
            ["Commit", "a3f7c2d", "Merged by Alex Lee"],
            ["Rollout", "100%", "3 regions · 24 instances"],
            ["Window", "4 min", "First anomaly at 10:06 AM"],
          ]}
        />
        <div className="detail-list" aria-label="Changed files">
          <span>
            <Icon name="file-code" size={16} />
            <b>services/checkout/cache.ts</b>
            <small>+8 −3</small>
          </span>
          <span>
            <Icon name="file-code" size={16} />
            <b>services/checkout/cart.ts</b>
            <small>+4 −1</small>
          </span>
          <span>
            <Icon name="git-diff" size={16} />
            <b>10 additional files</b>
            <small>Metadata only</small>
          </span>
        </div>
      </div>
    )
  if (item.id === "metrics")
    return (
      <div className="evidence-detail">
        <figure className="trace-chart">
          <figcaption>Heap growth after deployment</figcaption>
          <TrendChart />
        </figure>
        <section className="detail-side">
          <div className="detail-heading">
            <span className="detail-kicker">Metric readout</span>
            <strong>Memory does not return to baseline</strong>
          </div>
          <DetailFacts
            facts={[
              ["Current heap", "94%", "+56 pts from baseline"],
              ["Growth rate", "+18%", "Per 5-minute window"],
              ["Threshold", "85%", "Breached for 9 minutes"],
            ]}
          />
        </section>
      </div>
    )
  if (item.id === "trace")
    return (
      <div className="evidence-detail">
        <figure className="trace-chart">
          <figcaption>Latency (p95) &amp; Heap (%)</figcaption>
          <TrendChart />
        </figure>
        <CodeLocation />
      </div>
    )
  if (item.id === "runtime")
    return (
      <div className="evidence-detail detail-stack">
        <div className="detail-heading">
          <span className="detail-kicker">Runtime profile</span>
          <strong>
            Garbage collection is treating retained cache entries as live
            objects
          </strong>
        </div>
        <DetailFacts
          facts={[
            ["Full GC", "6×", "12 cycles in 10 minutes"],
            ["Pause p95", "1.2s", "Baseline 120ms"],
            ["Old space", "91%", "2.8 GB retained"],
          ]}
        />
        <div className="pressure-bars" aria-label="Runtime pressure">
          <div>
            <span>GC pause time</span>
            <i>
              <b style={{ width: "86%" }} />
            </i>
            <strong>High</strong>
          </div>
          <div>
            <span>Old-space use</span>
            <i>
              <b style={{ width: "91%" }} />
            </i>
            <strong>91%</strong>
          </div>
          <div>
            <span>Event-loop lag</span>
            <i>
              <b style={{ width: "64%" }} />
            </i>
            <strong>64%</strong>
          </div>
        </div>
      </div>
    )
  if (item.id === "code")
    return (
      <div className="evidence-detail">
        <CodeLocation />
        <section className="detail-side">
          <div className="detail-heading">
            <span className="detail-kicker">Ownership &amp; history</span>
            <strong>
              Cache key construction changed in the release commit
            </strong>
          </div>
          <DetailFacts
            facts={[
              ["Author", "Alex Lee", "Checkout platform team"],
              ["Pull request", "#1842", "Merged Jul 9, 2026"],
              ["Blame confidence", "96%", "Direct line ownership"],
            ]}
          />
        </section>
      </div>
    )
  if (item.id === "flag")
    return (
      <div className="evidence-detail detail-stack">
        <div className="detail-heading">
          <span className="detail-kicker">Change audit</span>
          <strong>Feature flags are ruled out as a contributing cause</strong>
        </div>
        <div className="audit-checks">
          <span>
            <Icon name="check-circle" size={17} />
            <b>checkout-cache-v2</b>
            <small>Unchanged for 18 days</small>
          </span>
          <span>
            <Icon name="check-circle" size={17} />
            <b>cart-key-normalization</b>
            <small>Disabled in production</small>
          </span>
          <span>
            <Icon name="check-circle" size={17} />
            <b>regional-cache-policy</b>
            <small>Consistent across all regions</small>
          </span>
        </div>
      </div>
    )
  return (
    <div className="evidence-detail detail-stack">
      <div className="detail-heading">
        <span className="detail-kicker">Cluster health</span>
        <strong>
          Infrastructure has sufficient capacity and no correlated failures
        </strong>
      </div>
      <DetailFacts
        facts={[
          ["CPU", "42%", "Stable across 24 pods"],
          ["Memory limit", "61%", "Node capacity available"],
          ["Network", "28%", "No packet loss detected"],
        ]}
      />
      <div className="detail-note">
        <Icon name="shield-check" size={18} />
        <span>
          <strong>Capacity constraint ruled out</strong>
          <small>
            No evictions, throttling, restarts, or node pressure in the incident
            window.
          </small>
        </span>
      </div>
    </div>
  )
}

function EvidenceRow({
  item,
  expanded,
  onToggle,
}: {
  item: Evidence
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <article className={`evidence-row ${expanded ? "is-expanded" : ""}`}>
      <button
        aria-expanded={expanded}
        className="evidence-row-button"
        onClick={onToggle}
        type="button"
      >
        <span className="sr-only">
          {expanded ? "Collapse" : "Expand"} {item.finding}.
        </span>
        <span className="timeline-marker" />
        <span className="evidence-time">
          <strong>{item.time}</strong>
          <small>Jul 14, 2026</small>
        </span>
        <span className="evidence-source">
          <Icon name={item.icon} size={18} />
          <span>
            <strong>{item.source}</strong>
            <small>{item.provider}</small>
          </span>
        </span>
        <span className="evidence-finding">
          <strong>{item.finding}</strong>
          <small>{item.detail}</small>
          {item.meta ? <small>{item.meta}</small> : null}
        </span>
        <span
          className={`validation ${item.validation === "Verified" ? "verified" : "high"}`}
        >
          {item.validation === "Verified" ? (
            <Icon name="check-circle" size={18} />
          ) : (
            <Icon name="warning-circle" size={18} />
          )}
          {item.validation}
        </span>
        <span className="row-caret">
          <Icon name={expanded ? "caret-up" : "caret-right"} size={16} />
        </span>
      </button>
      {expanded ? <EvidenceDetail item={item} /> : null}
    </article>
  )
}

type EvidenceViewProps = {
  items: Evidence[]
  total: number
  expandedId: string | null
  onToggle: (id: string) => void
  onNotify: (message: string) => void
}

export function EvidenceView({
  items,
  total,
  expandedId,
  onToggle,
  onNotify,
}: EvidenceViewProps) {
  return (
    <div className="evidence-table">
      <div className="evidence-columns" aria-hidden="true">
        <span>Time</span>
        <span>Source</span>
        <span>Finding</span>
        <span>Validation</span>
      </div>
      {items.length ? (
        items.map((item) => (
          <EvidenceRow
            expanded={expandedId === item.id}
            item={item}
            key={item.id}
            onToggle={() => onToggle(item.id)}
          />
        ))
      ) : (
        <div className="empty-state">
          <Icon name="magnifying-glass" size={24} />
          <strong>No matching evidence</strong>
          <span>Try a source, provider, or finding.</span>
        </div>
      )}
      <footer className="evidence-footer">
        <span>
          Showing latest {items.length} of {total} evidence events
        </span>
        <button
          className="secondary-button"
          onClick={() => onNotify("Evidence is up to date")}
          type="button"
        >
          <Icon name="arrow-down" size={16} /> Load newer evidence
        </button>
      </footer>
    </div>
  )
}
