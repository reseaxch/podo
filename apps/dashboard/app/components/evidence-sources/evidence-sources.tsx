"use client"

import { useEffect, useMemo, useRef, useState } from "react"

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
import { SelectMenu } from "../ui/select-menu"
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
  readOnly = false,
}: {
  model: EvidenceSourcesViewModel
  controller?: EvidenceSourcesController
  readOnly?: boolean
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
  const [dialogSourceId, setDialogSourceId] = useState<string | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const { toast, toastState, showToast } = useToast()

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
  const dialogSource =
    resolvedSources.find((source) => source.id === dialogSourceId) ?? null
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

  async function updateConnection(
    source: EvidenceSource,
    action: "connect" | "repair" | "disconnect",
    instance?: string,
  ): Promise<boolean> {
    setPendingId(source.id)
    setActionError(null)
    try {
      const input =
        action === "connect"
          ? {
              sourceId: source.id,
              action,
              expectedStatus: "Available" as const,
              instance: instance?.trim() ?? "",
            }
          : action === "repair"
            ? {
                sourceId: source.id,
                action,
                expectedStatus: "Needs attention" as const,
              }
            : {
                sourceId: source.id,
                action,
                expectedStatus: "Connected" as const,
              }
      const updated = await controllerRef.current.updateConnection(input)
      setSources((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setFilter("All")
      showToast(
        action === "connect"
          ? `${source.name} connected to the evidence pipeline`
          : action === "repair"
            ? `${source.name} permissions verified`
            : `${source.name} disconnected`,
      )
      return true
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "The connection was not changed",
      )
      return false
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
              Manage the systems Podo can cite during investigation and
              remediation.
            </p>
          </div>
          <div className={styles.headingActions}>
            <span className={styles.updated}>
              <Icon name="clock" size={15} /> {model.generatedAt}
            </span>
            {readOnly ? null : (
              <button
                className={styles.primaryButton}
                onClick={() => {
                  setActionError(null)
                  setCatalogOpen(true)
                }}
                type="button"
              >
                <Icon name="database" size={16} /> Add source
              </button>
            )}
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
              <SelectMenu
                ariaLabel="Filter by category"
                className={styles.categoryFilter}
                label="Category"
                onValueChange={setCategory}
                options={[
                  { value: "All", label: "All categories" },
                  ...categories.map((item) => ({ value: item, label: item })),
                ]}
                value={category}
              />
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
            pending={pendingId === selectedSource?.id}
            readOnly={readOnly}
            source={selectedSource}
            onManage={(source) => {
              setActionError(null)
              setDialogSourceId(source.id)
            }}
          />
        </section>
      </section>
      {catalogOpen ? (
        <AddSourceDialog
          onClose={() => setCatalogOpen(false)}
          onSelect={(source) => {
            setCatalogOpen(false)
            setFilter("All")
            setCategory("All")
            setQuery("")
            setSelectedId(source.id)
            setDialogSourceId(source.id)
          }}
          sources={resolvedSources}
        />
      ) : null}
      {dialogSource ? (
        <ConnectionDialog
          error={actionError}
          onClose={() => {
            if (!pendingId) setDialogSourceId(null)
          }}
          onSubmit={updateConnection}
          pending={pendingId === dialogSource.id}
          source={dialogSource}
        />
      ) : null}
      {toast ? (
        <div className="toast" data-motion-state={toastState} role="status">
          <Icon name="check-circle" /> {toast}
        </div>
      ) : null}
    </main>
  )
}

function SourceInspector({
  source,
  pending,
  onManage,
  readOnly,
}: {
  source: EvidenceSource | null
  pending: boolean
  onManage: (source: EvidenceSource) => void
  readOnly: boolean
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
            Credentials stay encrypted. Podo requests read access unless a
            remediation action requires explicit approval.
          </p>
        </section>
      )}

      <footer className={styles.inspectorFooter}>
        {readOnly ? null : (
          <button
            className={
              source.status === "Connected"
                ? styles.secondaryButton
                : styles.primaryButton
            }
            disabled={pending}
            onClick={() => onManage(source)}
            type="button"
          >
            {source.status === "Connected" ? (
              <Icon name="gear-six" size={16} />
            ) : (
              <Icon name="share-network" size={16} />
            )}
            {pending ? "Saving..." : actionLabel}
          </button>
        )}
        {source.status === "Connected" ? (
          <a
            aria-label={`Open ${source.name} externally`}
            className={styles.iconButton}
            href={source.externalUrl}
            rel="noreferrer"
            target="_blank"
            title="Open source"
          >
            <Icon name="arrow-square-out" size={16} />
          </a>
        ) : null}
      </footer>
    </aside>
  )
}

function AddSourceDialog({
  sources,
  onClose,
  onSelect,
}: {
  sources: EvidenceSource[]
  onClose: () => void
  onSelect: (source: EvidenceSource) => void
}) {
  const available = sources.filter((source) => source.status === "Available")

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [onClose])

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="add-source-title"
        aria-modal="true"
        className={`${styles.dialog} ${styles.catalogDialog}`}
        role="dialog"
      >
        <header>
          <span className={styles.dialogIcon}>
            <Icon name="database" size={21} />
          </span>
          <div>
            <small>Connector catalog</small>
            <h2 id="add-source-title">Add evidence source</h2>
          </div>
          <button
            aria-label="Close source catalog"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={17} />
          </button>
        </header>
        <div className={styles.dialogBody}>
          <p className={styles.catalogIntro}>
            Connect another read-only system so Podo can correlate its signals
            with incidents and the system graph.
          </p>
          {available.length ? (
            <div className={styles.connectorChoices}>
              {available.map((source) => (
                <button
                  aria-label={`Configure ${source.name}`}
                  key={source.id}
                  onClick={() => onSelect(source)}
                  type="button"
                >
                  <span className={styles.sourceIcon}>
                    <Icon name={source.icon} size={19} />
                  </span>
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.description}</small>
                    <i>{source.evidenceKinds.join(" · ")}</i>
                  </span>
                  <Icon name="caret-right" size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.catalogComplete}>
              <Icon name="check-circle" size={24} />
              <strong>Every catalog source is configured</strong>
              <p>Manage existing connectors from their detail panel.</p>
            </div>
          )}
        </div>
        <footer>
          <button onClick={onClose} type="button">
            Close
          </button>
        </footer>
      </section>
    </div>
  )
}

function ConnectionDialog({
  source,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  source: EvidenceSource
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (
    source: EvidenceSource,
    action: "connect" | "repair" | "disconnect",
    instance?: string,
  ) => Promise<boolean>
}) {
  const [instance, setInstance] = useState(
    source.connection?.instance ?? `${source.name} workspace`,
  )
  const [confirmed, setConfirmed] = useState(false)
  const [step, setStep] = useState<"configure" | "authorize" | "success">(
    "configure",
  )
  const [action] = useState<"connect" | "repair" | "disconnect">(() =>
    source.status === "Available"
      ? "connect"
      : source.status === "Needs attention"
        ? "repair"
        : "disconnect",
  )

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [onClose, pending])

  const title =
    step === "success"
      ? action === "connect"
        ? `${source.name} connected`
        : action === "repair"
          ? `${source.name} verified`
          : `${source.name} disconnected`
      : action === "connect"
        ? `Connect ${source.name}`
        : action === "repair"
          ? `Review ${source.name}`
          : `Manage ${source.name}`
  const canSubmit =
    confirmed && (action !== "connect" || instance.trim().length >= 3)

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <section
        aria-labelledby="evidence-connection-title"
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <header>
          <span className={styles.dialogIcon}>
            <Icon name={source.icon} size={21} />
          </span>
          <div>
            <small>{source.provider} connector</small>
            <h2 id="evidence-connection-title">{title}</h2>
          </div>
          <button
            aria-label="Close connection dialog"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className={styles.dialogBody}>
          {step === "success" ? (
            <section className={styles.connectionSuccess}>
              <span>
                <Icon name="check-circle" size={27} />
              </span>
              <strong>
                {action === "connect"
                  ? "Evidence ingestion is ready"
                  : action === "repair"
                    ? "Connector access is healthy"
                    : "Evidence ingestion has stopped"}
              </strong>
              <p>
                {action === "disconnect"
                  ? "Existing evidence remains attached to incidents and the audit trail."
                  : `${source.name} is mapped to the Podo evidence pipeline. New signals will appear after the first sync.`}
              </p>
              {action !== "disconnect" ? (
                <div className={styles.successFacts}>
                  <span>
                    <small>Connection</small>
                    <strong>Healthy</strong>
                  </span>
                  <span>
                    <small>Access</small>
                    <strong>Read only</strong>
                  </span>
                  <span>
                    <small>First sync</small>
                    <strong>Queued</strong>
                  </span>
                </div>
              ) : null}
            </section>
          ) : step === "authorize" ? (
            <section className={styles.authorizationStep}>
              <div className={styles.authorizationRoute}>
                <span className={styles.dialogIcon}>
                  <Icon name="cube" size={20} />
                </span>
                <Icon name="caret-right" size={15} />
                <span className={styles.dialogIcon}>
                  <Icon name={source.icon} size={20} />
                </span>
              </div>
              <strong>Authorize Podo in {source.name}</strong>
              <p>
                A provider window will verify the workspace and requested
                scopes. In this mock, authorization is completed locally.
              </p>
              <div className={styles.authorizationTarget}>
                <small>Connection target</small>
                <strong>{instance}</strong>
              </div>
              <section className={styles.scopePanel}>
                <div>
                  <Icon name="shield-check" size={17} />
                  <span>
                    <strong>No production write access</strong>
                    <small>
                      Provider authorization is limited to the evidence scopes
                      reviewed in the previous step.
                    </small>
                  </span>
                </div>
              </section>
            </section>
          ) : action === "connect" ? (
            <label className={styles.dialogField}>
              <span>Workspace or instance</span>
              <input
                autoFocus
                onChange={(event) => setInstance(event.target.value)}
                placeholder="Production workspace"
                value={instance}
              />
              <small>
                Credentials are collected by the provider authorization flow,
                never stored in this form.
              </small>
            </label>
          ) : (
            <section className={styles.dialogSummary}>
              <span
                className={`${styles.status} ${statusClass(source.status)}`}
              >
                {source.status}
              </span>
              <strong>{source.connection?.instance}</strong>
              <p>{source.health.detail}</p>
            </section>
          )}

          {step === "configure" ? (
            <section className={styles.scopePanel}>
              <div>
                <Icon name="shield-check" size={17} />
                <span>
                  <strong>Read-only evidence boundary</strong>
                  <small>
                    Podo can read the selected evidence types but cannot mutate
                    production through this connector.
                  </small>
                </span>
              </div>
              <div className={styles.permissions}>
                {(source.connection?.permissions ?? source.evidenceKinds).map(
                  (permission) => (
                    <code key={permission}>{permission}</code>
                  ),
                )}
              </div>
            </section>
          ) : null}

          {step === "configure" ? (
            <label className={styles.confirmRow}>
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>
                {action === "disconnect"
                  ? "I understand new evidence will stop ingesting. Existing incident evidence remains available."
                  : "I reviewed the requested scopes and connection target."}
              </span>
            </label>
          ) : null}
          {error ? (
            <p className={styles.dialogError} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer>
          {step === "success" ? (
            <>
              {action !== "disconnect" ? (
                <a
                  className={styles.secondaryButton}
                  href={source.externalUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open {source.name}
                  <Icon name="arrow-square-out" size={14} />
                </a>
              ) : null}
              <button
                className={styles.primaryButton}
                onClick={onClose}
                type="button"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                disabled={pending}
                onClick={() =>
                  step === "authorize" ? setStep("configure") : onClose()
                }
                type="button"
              >
                {step === "authorize" ? "Back" : "Cancel"}
              </button>
              <button
                className={
                  action === "disconnect"
                    ? styles.dangerButton
                    : styles.primaryButton
                }
                disabled={(step === "configure" && !canSubmit) || pending}
                onClick={() => {
                  if (action === "connect" && step === "configure") {
                    setStep("authorize")
                    return
                  }
                  void onSubmit(source, action, instance).then((succeeded) => {
                    if (succeeded) setStep("success")
                  })
                }}
                type="button"
              >
                {pending
                  ? "Authorizing..."
                  : action === "connect" && step === "configure"
                    ? "Continue to authorization"
                    : action === "connect"
                      ? `Authorize ${source.name}`
                      : action === "repair"
                        ? "Verify permissions"
                        : "Disconnect source"}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
