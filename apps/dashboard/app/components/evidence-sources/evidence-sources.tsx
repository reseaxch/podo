"use client"

import { useMemo, useRef, useState } from "react"

import { useToast } from "../../hooks/use-toast"
import type {
  EvidenceSource,
  EvidenceSourceCategory,
  EvidenceSourceStatus,
  EvidenceSourcesController,
  EvidenceSourcesViewModel,
} from "../../lib/evidence-source-types"
import { createMockEvidenceSourcesController } from "../../mocks/evidence-sources-controller"
import { IconRail } from "../shell/icon-rail"
import { Topbar } from "../shell/topbar"
import { Icon } from "../ui/pictogram"
import styles from "./evidence-sources.module.css"

type SourceFilter = "All" | EvidenceSourceStatus

const filterOptions: { label: string; value: SourceFilter }[] = [
  { label: "All sources", value: "All" },
  { label: "Connected", value: "Connected" },
  { label: "Needs attention", value: "Needs attention" },
  { label: "Available", value: "Available" },
]

function formatSignalCount(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value)
}

function statusClass(status: EvidenceSourceStatus) {
  if (status === "Connected") return styles.statusConnected
  if (status === "Needs attention") return styles.statusAttention
  return styles.statusAvailable
}

export function EvidenceSources({
  model,
  controller,
}: {
  model: EvidenceSourcesViewModel
  controller?: EvidenceSourcesController
}) {
  const controllerRef = useRef(
    controller ??
      createMockEvidenceSourcesController(model.sources, model.owner.name),
  )
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SourceFilter>("All")
  const [category, setCategory] = useState<"All" | EvidenceSourceCategory>(
    "All",
  )
  const [selectedId, setSelectedId] = useState(model.sources[0]?.id ?? null)
  const [sources, setSources] = useState(() => structuredClone(model.sources))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { toast, showToast } = useToast()

  const categories = useMemo(
    () => Array.from(new Set(sources.map((source) => source.category))).sort(),
    [sources],
  )

  const resolvedSources = sources

  const filteredSources = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return resolvedSources.filter(
      (source) =>
        (filter === "All" || source.status === filter) &&
        (category === "All" || source.category === category) &&
        (!normalized ||
          `${source.name} ${source.provider} ${source.description} ${source.evidenceKinds.join(" ")}`
            .toLowerCase()
            .includes(normalized)),
    )
  }, [category, filter, query, resolvedSources])

  const selectedSource =
    resolvedSources.find((source) => source.id === selectedId) ?? null
  const connectedCount = resolvedSources.filter(
    (source) => source.status === "Connected",
  ).length
  const attentionCount = resolvedSources.filter(
    (source) => source.status === "Needs attention",
  ).length
  const signalCount = resolvedSources.reduce(
    (total, source) => total + source.signalCount,
    0,
  )

  async function connectSource(source: EvidenceSource) {
    if (source.status === "Connected") {
      showToast(`${source.name} connection settings opened`)
      return
    }
    setPendingId(source.id)
    setActionError(null)
    try {
      const updated = await controllerRef.current.updateConnection({
        sourceId: source.id,
        action: source.status === "Available" ? "connect" : "repair",
        expectedStatus: source.status,
      })
      setSources((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      showToast(
        source.status === "Available"
          ? `${source.name} connected to the evidence pipeline`
          : `${source.name} permissions verified`,
      )
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "The connection was not changed",
      )
    } finally {
      setPendingId(null)
    }
  }

  function resetFilters() {
    setQuery("")
    setFilter("All")
    setCategory("All")
  }

  return (
    <main className="app-shell" data-ready="true">
      <IconRail />
      <Topbar
        current="Evidence sources"
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={model.owner}
        query={query}
        searchLabel="Search evidence sources"
        searchPlaceholder="Search sources..."
      />

      <section className={styles.page}>
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Evidence pipeline</span>
            <h1>Evidence sources</h1>
            <p>
              Manage the systems Rootline can cite during investigation and
              remediation.
            </p>
          </div>
          <div className={styles.headingActions}>
            <span className={styles.updated}>
              <Icon name="clock" size={15} /> {model.generatedAt}
            </span>
            <button
              className={styles.primaryButton}
              onClick={() => {
                setFilter("Available")
                setCategory("All")
                showToast("Showing connectors ready to configure")
              }}
              type="button"
            >
              <Icon name="database" size={16} /> Add source
            </button>
          </div>
        </header>

        <section className={styles.summary} aria-label="Connection summary">
          <article className={styles.healthSummary}>
            <div className={styles.healthMark}>
              <Icon name="share-network" size={24} />
            </div>
            <div>
              <span>Pipeline health</span>
              <strong>
                {attentionCount
                  ? `${attentionCount} source needs review`
                  : "All sources healthy"}
              </strong>
              <small>
                {connectedCount} connected sources are mapped to the system
                graph.
              </small>
            </div>
            <button
              onClick={() =>
                setFilter(attentionCount ? "Needs attention" : "Connected")
              }
              type="button"
            >
              Review <Icon name="caret-right" size={14} />
            </button>
          </article>
          <div className={styles.metrics}>
            <span>
              <small>Connected</small>
              <strong>{connectedCount}</strong>
              <em>of {resolvedSources.length}</em>
            </span>
            <span>
              <small>Signals today</small>
              <strong>{formatSignalCount(signalCount)}</strong>
              <em>normalized events</em>
            </span>
            <span>
              <small>Graph coverage</small>
              <strong>14</strong>
              <em>mapped services</em>
            </span>
          </div>
        </section>

        <section className={styles.workspace}>
          <div className={styles.catalog}>
            <div className={styles.toolbar}>
              <div
                className={styles.filters}
                role="tablist"
                aria-label="Connection status"
              >
                {filterOptions.map((option) => {
                  const count = resolvedSources.filter(
                    (source) =>
                      option.value === "All" || source.status === option.value,
                  ).length
                  return (
                    <button
                      aria-selected={filter === option.value}
                      key={option.value}
                      onClick={() => setFilter(option.value)}
                      role="tab"
                      type="button"
                    >
                      {option.label} <span>{count}</span>
                    </button>
                  )
                })}
              </div>
              <label className={styles.categoryFilter}>
                <span>Category</span>
                <select
                  aria-label="Filter by category"
                  onChange={(event) =>
                    setCategory(event.target.value as typeof category)
                  }
                  value={category}
                >
                  <option value="All">All categories</option>
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <Icon name="caret-down" size={13} />
              </label>
            </div>

            <div className={styles.catalogHeading}>
              <div>
                <strong>Source catalog</strong>
                <small>{filteredSources.length} matching connectors</small>
              </div>
              <span>Signals from the last 24 hours</span>
            </div>

            {filteredSources.length ? (
              <div className={styles.sourceList}>
                {filteredSources.map((source) => (
                  <button
                    aria-pressed={selectedSource?.id === source.id}
                    className={styles.sourceRow}
                    key={source.id}
                    onClick={() => setSelectedId(source.id)}
                    type="button"
                  >
                    <span className="sr-only">Inspect {source.name}. </span>
                    <span className={styles.sourceIcon}>
                      <Icon name={source.icon} size={20} />
                    </span>
                    <span className={styles.sourceIdentity}>
                      <strong>{source.name}</strong>
                      <small>
                        {source.category} / {source.provider}
                      </small>
                    </span>
                    <span className={styles.sourceKinds}>
                      {source.evidenceKinds.slice(0, 3).map((kind) => (
                        <i key={kind}>{kind}</i>
                      ))}
                    </span>
                    <span className={styles.sourceVolume}>
                      <strong>{formatSignalCount(source.signalCount)}</strong>
                      <small>{source.lastSync}</small>
                    </span>
                    <span
                      className={`${styles.status} ${statusClass(source.status)}`}
                    >
                      {source.status === "Connected" ? (
                        <Icon name="check-circle" size={14} />
                      ) : source.status === "Needs attention" ? (
                        <Icon name="warning-circle" size={14} />
                      ) : null}
                      {source.status}
                    </span>
                    <Icon name="caret-right" size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <span>
                  <Icon name="magnifying-glass" size={22} />
                </span>
                <strong>No sources match these filters</strong>
                <p>Clear the search or show every connector in the catalog.</p>
                <button onClick={resetFilters} type="button">
                  Reset filters
                </button>
              </div>
            )}
          </div>

          <SourceInspector
            error={actionError}
            pending={pendingId === selectedSource?.id}
            source={selectedSource}
            onAction={connectSource}
          />
        </section>
      </section>
      {toast ? (
        <div className="toast" role="status">
          <Icon name="check-circle" /> {toast}
        </div>
      ) : null}
    </main>
  )
}

function SourceInspector({
  source,
  pending,
  error,
  onAction,
}: {
  source: EvidenceSource | null
  pending: boolean
  error: string | null
  onAction: (source: EvidenceSource) => Promise<void>
}) {
  if (!source) {
    return (
      <aside className={styles.inspector} aria-label="Source details">
        <div className={styles.inspectorEmpty}>
          <Icon name="database" size={22} />
          <strong>Select a source</strong>
          <p>Connection details and evidence coverage will appear here.</p>
        </div>
      </aside>
    )
  }

  const actionLabel =
    source.status === "Available"
      ? "Connect source"
      : source.status === "Needs attention"
        ? "Review permissions"
        : "Manage connection"

  return (
    <aside className={styles.inspector} aria-label={`${source.name} details`}>
      <header className={styles.inspectorHeader}>
        <span className={styles.inspectorIcon}>
          <Icon name={source.icon} size={23} />
        </span>
        <div>
          <small>{source.provider}</small>
          <h2>{source.name}</h2>
        </div>
        <span className={`${styles.status} ${statusClass(source.status)}`}>
          {source.status}
        </span>
      </header>
      <p className={styles.description}>{source.description}</p>

      <section className={styles.healthPanel}>
        <span>
          <Icon
            name={
              source.status === "Needs attention"
                ? "warning-circle"
                : "check-circle"
            }
            size={17}
          />
        </span>
        <div>
          <strong>{source.health.label}</strong>
          <p>{source.health.detail}</p>
        </div>
      </section>

      <section className={styles.detailSection}>
        <h3>Evidence coverage</h3>
        <div className={styles.coverageGrid}>
          {source.evidenceKinds.map((kind) => (
            <span key={kind}>
              <Icon name="check-circle" size={14} /> {kind}
            </span>
          ))}
        </div>
      </section>

      {source.connection ? (
        <section className={styles.detailSection}>
          <h3>Connection</h3>
          <dl className={styles.definitionList}>
            <div>
              <dt>Instance</dt>
              <dd>{source.connection.instance}</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>{source.connection.authentication}</dd>
            </div>
            <div>
              <dt>Connected by</dt>
              <dd>{source.connection.connectedBy}</dd>
            </div>
            <div>
              <dt>Retention</dt>
              <dd>{source.connection.retention}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {source.connection ? (
        <section className={styles.detailSection}>
          <h3>Granted permissions</h3>
          <div className={styles.permissions}>
            {source.connection.permissions.map((permission) => (
              <code key={permission}>{permission}</code>
            ))}
          </div>
        </section>
      ) : (
        <section className={styles.setupNote}>
          <Icon name="shield-check" size={17} />
          <p>
            Credentials stay encrypted. Rootline requests read access unless a
            remediation action requires explicit approval.
          </p>
        </section>
      )}

      <footer className={styles.inspectorFooter}>
        {error ? (
          <p className={styles.actionError} role="alert">
            {error}
          </p>
        ) : null}
        <button
          className={
            source.status === "Connected"
              ? styles.secondaryButton
              : styles.primaryButton
          }
          disabled={pending}
          onClick={() => void onAction(source)}
          type="button"
        >
          {source.status === "Connected" ? (
            <Icon name="gear-six" size={16} />
          ) : (
            <Icon name="share-network" size={16} />
          )}
          {pending ? "Saving..." : actionLabel}
        </button>
        {source.status === "Connected" ? (
          <button
            aria-label={`Open ${source.name} externally`}
            className={styles.iconButton}
            onClick={() => void onAction(source)}
            title="Open source"
            type="button"
          >
            <Icon name="arrow-square-out" size={16} />
          </button>
        ) : null}
      </footer>
    </aside>
  )
}
