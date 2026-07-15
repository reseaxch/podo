"use client"

import Link from "next/link"
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { IconRail } from "../components/shell/icon-rail"
import { Topbar } from "../components/shell/topbar"
import { Icon } from "../components/ui/pictogram"
import { useToast } from "../hooks/use-toast"
import type { IconName } from "../lib/incident-types"
import type {
  GraphHealth,
  GraphLayer,
  SystemGraphNode,
  SystemGraphViewModel,
} from "./system-graph-data"
import styles from "./system-graph.module.css"

type LayerFilter = "all" | GraphLayer
type Viewport = { x: number; y: number; zoom: number }

const nodeIcons: Record<SystemGraphNode["kind"], IconName> = {
  service: "cube",
  database: "database",
  queue: "stack",
  external: "arrow-square-out",
  deployment: "rocket-launch",
  commit: "git-branch",
  file: "file-code",
}

const healthLabels: Record<GraphHealth, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  changed: "Recent change",
}

const initialViewport: Viewport = { x: 0, y: 0, zoom: 0.82 }
const graphWidth = 1300
const graphHeight = 830
const nodeWidth = 204
const nodeHeight = 100
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

function graphPath(from: SystemGraphNode, to: SystemGraphNode) {
  const startX = from.x + 102
  const startY = from.y + 50
  const endX = to.x + 102
  const endY = to.y + 50
  if (Math.abs(endY - startY) > Math.abs(endX - startX)) {
    const middleY = (startY + endY) / 2
    return `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`
  }
  const middleX = (startX + endX) / 2
  return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`
}

export function SystemGraphWorkspace({
  graph,
}: {
  graph: SystemGraphViewModel
}) {
  const [query, setQuery] = useState("")
  const [layer, setLayer] = useState<LayerFilter>("all")
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [selectedId, setSelectedId] = useState("checkout-service")
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [inspectorEngaged, setInspectorEngaged] = useState(false)
  const [tracesOpen, setTracesOpen] = useState(false)
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [viewport, setViewport] = useState(initialViewport)
  const [windowIndex, setWindowIndex] = useState(0)
  const canvasRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const spotlightFrameRef = useRef<number | null>(null)
  const dragRef = useRef<{
    x: number
    y: number
    originX: number
    originY: number
  } | null>(null)
  const autoFitRef = useRef(true)
  const { toast, showToast } = useToast()
  const activeWindow = graph.windows[windowIndex] ?? {
    label: "Last 30m",
    traces: graph.stats.traces,
    capturedAt: graph.capturedAt,
  }

  const visibleNodes = useMemo(
    () =>
      graph.nodes.filter(
        (node) =>
          (layer === "all" || node.layer === layer) &&
          (!issuesOnly || node.health !== "healthy"),
      ),
    [graph.nodes, issuesOnly, layer],
  )
  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const matchingIds = useMemo(
    () =>
      new Set(
        visibleNodes
          .filter((node) =>
            `${node.label} ${node.subtitle} ${node.kind} ${node.owner}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
          .map((node) => node.id),
      ),
    [normalizedQuery, visibleNodes],
  )
  const resolvedSelectedId = visibleIds.has(selectedId)
    ? selectedId
    : (visibleNodes[0]?.id ?? "")
  const selected =
    graph.nodes.find((node) => node.id === resolvedSelectedId) ?? null
  const selectedTrace =
    selected?.traces?.find((trace) => trace.id === selectedTraceId) ??
    selected?.traces?.[0] ??
    null
  const selectedIncident = selected?.evidence.find(
    (item) => item.label === "Open incident",
  )?.value

  const fitGraph = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !visibleNodes.length || !canvas.clientWidth) return

    const padding = canvas.clientWidth < 600 ? 28 : 54
    const minX = Math.min(...visibleNodes.map((node) => node.x))
    const minY = Math.min(...visibleNodes.map((node) => node.y))
    const maxX = Math.max(...visibleNodes.map((node) => node.x + nodeWidth))
    const maxY = Math.max(...visibleNodes.map((node) => node.y + nodeHeight))
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    const zoom = clamp(
      Math.min(
        (canvas.clientWidth - padding * 2) / contentWidth,
        (canvas.clientHeight - padding * 2) / contentHeight,
      ),
      0.28,
      1.25,
    )

    setViewport({
      x: (canvas.clientWidth - contentWidth * zoom) / 2 - minX * zoom,
      y: (canvas.clientHeight - contentHeight * zoom) / 2 - minY * zoom,
      zoom,
    })
    autoFitRef.current = true
  }, [visibleNodes])

  const setZoom = useCallback((next: number) => {
    const canvas = canvasRef.current
    autoFitRef.current = false
    setViewport((current) => {
      const zoom = clamp(next, 0.28, 1.5)
      const centerX = (canvas?.clientWidth ?? graphWidth * current.zoom) / 2
      const centerY = (canvas?.clientHeight ?? graphHeight * current.zoom) / 2
      const sceneX = (centerX - current.x) / current.zoom
      const sceneY = (centerY - current.y) / current.zoom
      return {
        zoom,
        x: centerX - sceneX * zoom,
        y: centerY - sceneY * zoom,
      }
    })
  }, [])

  useLayoutEffect(() => {
    fitGraph()
  }, [fitGraph])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (autoFitRef.current) fitGraph()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [fitGraph])

  useEffect(() => {
    if (!tracesOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTracesOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [tracesOpen])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const deltaUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1
      const delta = event.deltaY * deltaUnit
      const bounds = canvas.getBoundingClientRect()
      const pointerX = event.clientX - bounds.left
      const pointerY = event.clientY - bounds.top
      autoFitRef.current = false
      setViewport((current) => {
        const zoom = clamp(current.zoom - delta * 0.001, 0.28, 1.5)
        const sceneX = (pointerX - current.x) / current.zoom
        const sceneY = (pointerY - current.y) / current.zoom
        return {
          zoom,
          x: pointerX - sceneX * zoom,
          y: pointerY - sceneY * zoom,
        }
      })
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false })
    return () => {
      canvas.removeEventListener("wheel", handleWheel)
      if (spotlightFrameRef.current !== null)
        window.cancelAnimationFrame(spotlightFrameRef.current)
    }
  }, [])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return
    autoFitRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const canvas = canvasRef.current
    const spotlight = spotlightRef.current
    if (canvas && spotlight && spotlightFrameRef.current === null) {
      const { clientX, clientY } = event
      spotlightFrameRef.current = window.requestAnimationFrame(() => {
        const bounds = canvas.getBoundingClientRect()
        spotlight.style.transform = `translate3d(${clientX - bounds.left}px, ${clientY - bounds.top}px, 0) translate3d(-50%, -50%, 0)`
        spotlightFrameRef.current = null
      })
    }
    const drag = dragRef.current
    if (!drag) return
    setViewport((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    }))
  }

  return (
    <main className="app-shell" data-ready="true">
      <IconRail />
      <Topbar
        current="System graph"
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={graph.owner}
        query={query}
        searchLabel="Search system graph"
        searchPlaceholder="Search services, commits, owners..."
      />

      <section className={styles.page}>
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>System intelligence</span>
            <div className={styles.titleRow}>
              <h1>Global system graph</h1>
              <span className={styles.live}>
                <i /> Live
              </span>
            </div>
            <p>
              Trace runtime pressure through deployments, commits, and code.
            </p>
          </div>
          <div className={styles.summary} aria-label="Graph summary">
            <span>
              <strong>{graph.stats.services}</strong>
              <small>components</small>
            </span>
            <span className={styles.alertMetric}>
              <strong>{graph.stats.unhealthy}</strong>
              <small>unhealthy</small>
            </span>
            <span>
              <strong>{graph.stats.changes}</strong>
              <small>recent change</small>
            </span>
            <span>
              <strong>{activeWindow.traces}</strong>
              <small>traces / {activeWindow.label.slice(5)}</small>
            </span>
          </div>
        </header>

        <div className={styles.contextBar}>
          <div className={styles.scope}>
            <span>
              <Icon name="activity" size={14} /> {activeWindow.capturedAt}
            </span>
            <span>
              <Icon name="stack" size={14} /> {graph.environment}
            </span>
          </div>
          <div className={styles.filters}>
            <div
              className={styles.segmented}
              role="group"
              aria-label="Graph layer"
            >
              {(["all", "runtime", "delivery", "code"] as const).map((item) => (
                <button
                  aria-pressed={layer === item}
                  key={item}
                  onClick={() => setLayer(item)}
                  type="button"
                >
                  {item === "all"
                    ? "All layers"
                    : item.charAt(0).toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            <button
              aria-pressed={issuesOnly}
              className={styles.filterButton}
              onClick={() => setIssuesOnly((current) => !current)}
              type="button"
            >
              <i className={styles.issueDot} /> Issues only
            </button>
            <button
              className={styles.filterButton}
              onClick={() =>
                setWindowIndex(
                  (current) =>
                    (current + 1) % Math.max(graph.windows.length, 1),
                )
              }
              type="button"
            >
              <Icon name="clock" size={14} /> {activeWindow.label}
            </button>
          </div>
        </div>

        <div
          className={`${styles.workspace} ${!detailsOpen ? styles.workspaceFull : ""}`}
        >
          <section
            className={styles.graphPanel}
            aria-label="System dependency graph"
          >
            <div className={styles.graphMeta}>
              <span>
                {visibleNodes.length} nodes ·{" "}
                {
                  graph.edges.filter(
                    (edge) =>
                      visibleIds.has(edge.from) && visibleIds.has(edge.to),
                  ).length
                }{" "}
                relations
              </span>
              {normalizedQuery ? (
                <strong>{matchingIds.size} matches</strong>
              ) : (
                <span>Drag to pan · scroll to zoom</span>
              )}
            </div>
            <div
              aria-label="Pan and zoom system graph"
              className={styles.canvas}
              onPointerCancel={() => {
                dragRef.current = null
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => {
                dragRef.current = null
              }}
              ref={canvasRef}
            >
              <div
                aria-hidden="true"
                className={styles.spotlight}
                ref={spotlightRef}
              />
              {!graph.nodes.length ? (
                <div className={styles.emptyGraph}>
                  <Icon name="graph" size={26} />
                  <strong>No topology indexed yet</strong>
                  <p>
                    Connect an evidence source to map services and dependencies.
                  </p>
                </div>
              ) : null}
              <div
                className={styles.scene}
                style={{
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                }}
              >
                <svg
                  aria-hidden="true"
                  className={styles.edges}
                  viewBox="0 0 1300 830"
                >
                  <defs>
                    <marker
                      id="graph-arrow"
                      markerHeight="8"
                      markerWidth="8"
                      orient="auto"
                      refX="7"
                      refY="4"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" />
                    </marker>
                  </defs>
                  {graph.edges.map((edge) => {
                    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to))
                      return null
                    const from = graph.nodes.find(
                      (node) => node.id === edge.from,
                    )!
                    const to = graph.nodes.find((node) => node.id === edge.to)!
                    const dimmed =
                      normalizedQuery &&
                      !matchingIds.has(from.id) &&
                      !matchingIds.has(to.id)
                    return (
                      <g
                        className={`${styles.edge} ${styles[edge.health]} ${dimmed ? styles.dimmed : ""}`}
                        key={edge.id}
                      >
                        <path
                          d={graphPath(from, to)}
                          markerEnd="url(#graph-arrow)"
                        />
                      </g>
                    )
                  })}
                </svg>

                {visibleNodes.map((node) => (
                  <button
                    aria-pressed={resolvedSelectedId === node.id}
                    className={`${styles.node} ${styles[node.health] ?? ""} ${normalizedQuery && !matchingIds.has(node.id) ? styles.dimmed : ""}`}
                    key={node.id}
                    onClick={() => {
                      setSelectedId(node.id)
                      setDetailsOpen(true)
                      setInspectorEngaged(true)
                      setTracesOpen(false)
                      setSelectedTraceId(node.traces?.[0]?.id ?? null)
                    }}
                    style={{ left: node.x, top: node.y }}
                    type="button"
                  >
                    <span className="sr-only">Inspect {node.label}. </span>
                    <span className={styles.nodeIcon}>
                      <Icon name={nodeIcons[node.kind]} size={17} />
                    </span>
                    <span className={styles.nodeCopy}>
                      <small>{node.kind}</small>
                      <strong>{node.label}</strong>
                      <em>{node.subtitle}</em>
                    </span>
                    <span className={styles.nodeMetrics}>
                      {node.metrics.map((metric) => (
                        <span key={metric.label}>
                          <small>{metric.label}</small>
                          <b>{metric.value}</b>
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>

              <div
                className={styles.zoomControls}
                aria-label="Graph viewport controls"
              >
                <button
                  aria-label="Zoom in"
                  onClick={() => setZoom(viewport.zoom + 0.1)}
                  type="button"
                >
                  +
                </button>
                <span>{Math.round(viewport.zoom * 100)}%</span>
                <button
                  aria-label="Zoom out"
                  onClick={() => setZoom(viewport.zoom - 0.1)}
                  type="button"
                >
                  −
                </button>
                <button aria-label="Fit graph" onClick={fitGraph} type="button">
                  Fit
                </button>
              </div>

              <div className={styles.legend} aria-label="Graph legend">
                <span>
                  <i className={styles.legendHealthy} /> Healthy
                </span>
                <span>
                  <i className={styles.legendDegraded} /> Degraded
                </span>
                <span>
                  <i className={styles.legendCritical} /> Critical
                </span>
                <span>
                  <i className={styles.legendChanged} /> Recent change
                </span>
                <b />
                <span>
                  <i className={styles.legendCausal} /> Causal path
                </span>
              </div>
            </div>
          </section>

          {detailsOpen && selected ? (
            <aside
              className={`${styles.inspector} ${!inspectorEngaged ? styles.inspectorInitial : ""}`}
              aria-label="Node details"
            >
              <header>
                <div
                  className={`${styles.inspectorIcon} ${styles[selected.health]}`}
                >
                  <Icon name={nodeIcons[selected.kind]} size={19} />
                </div>
                <div>
                  <span>
                    {selected.kind} · {selected.environment}
                  </span>
                  <h2>{selected.label}</h2>
                </div>
                <button
                  aria-label="Close node details"
                  onClick={() => setDetailsOpen(false)}
                  type="button"
                >
                  <Icon name="x" size={15} />
                </button>
              </header>
              <div className={styles.healthStrip}>
                <span>
                  <i className={styles[selected.health]} />{" "}
                  {healthLabels[selected.health]}
                </span>
                <small>Updated {selected.updated}</small>
              </div>
              <p className={styles.description}>{selected.description}</p>

              <section className={styles.metricGrid} aria-label="Node metrics">
                {selected.metrics.map((metric) => (
                  <span key={metric.label}>
                    <small>{metric.label}</small>
                    <strong>{metric.value}</strong>
                    {metric.trend ? <em>{metric.trend}</em> : null}
                  </span>
                ))}
              </section>

              <section className={styles.evidenceBlock}>
                <div className={styles.sectionTitle}>
                  <span>Correlated evidence</span>
                  <small>{selected.evidence.length} signals</small>
                </div>
                {selected.evidence.map((item) => (
                  <div className={styles.evidenceRow} key={item.label}>
                    <span>
                      <i className={styles[item.tone]} /> {item.label}
                    </span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </section>

              <section className={styles.causalBlock}>
                <div className={styles.sectionTitle}>
                  <span>Why it matters</span>
                  <small>causal context</small>
                </div>
                <div className={styles.causalFlow}>
                  <span>
                    <i>1</i>
                    <b>Deploy v1.8.4</b>
                    <small>42m ago</small>
                  </span>
                  <span>
                    <i>2</i>
                    <b>Heap began climbing</b>
                    <small>+9m</small>
                  </span>
                  <span>
                    <i>3</i>
                    <b>Checkout errors</b>
                    <small>8.7%</small>
                  </span>
                </div>
              </section>

              <div className={styles.inspectorActions}>
                <button
                  onClick={() => {
                    setSelectedTraceId(selected.traces?.[0]?.id ?? null)
                    setTracesOpen(true)
                  }}
                  type="button"
                >
                  <Icon name="activity" size={15} /> Explore traces
                </button>
                {selectedIncident ? (
                  <Link href="/#workspace">
                    Open incident <Icon name="caret-right" size={14} />
                    <span className="sr-only"> {selectedIncident}</span>
                  </Link>
                ) : (
                  <Link href="/evidence-sources">
                    View evidence <Icon name="caret-right" size={14} />
                  </Link>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      </section>

      {tracesOpen && selected ? (
        <div
          className={styles.traceBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTracesOpen(false)
          }}
        >
          <section
            aria-label={`Trace explorer for ${selected.label}`}
            aria-modal="true"
            className={styles.traceDialog}
            role="dialog"
          >
            <header>
              <span className={styles.traceDialogIcon}>
                <Icon name="activity" size={19} />
              </span>
              <div>
                <small>Correlated traces</small>
                <h2>{selected.label}</h2>
              </div>
              <button
                aria-label="Close trace explorer"
                onClick={() => setTracesOpen(false)}
                type="button"
              >
                <Icon name="x" size={16} />
              </button>
            </header>
            {selected.traces?.length ? (
              <div className={styles.traceWorkspace}>
                <div className={styles.traceList} role="list">
                  {selected.traces.map((trace) => (
                    <button
                      aria-pressed={selectedTrace?.id === trace.id}
                      key={trace.id}
                      onClick={() => setSelectedTraceId(trace.id)}
                      type="button"
                    >
                      <i className={styles[trace.status]} />
                      <span>
                        <strong>{trace.name}</strong>
                        <small>
                          {trace.id} · {trace.startedAt}
                        </small>
                      </span>
                      <span>
                        <strong>{trace.duration}</strong>
                        <small>{trace.spans} spans</small>
                      </span>
                    </button>
                  ))}
                </div>
                {selectedTrace ? (
                  <aside className={styles.traceDetails}>
                    <span className={styles.traceStatus}>
                      <i className={styles[selectedTrace.status]} />{" "}
                      {selectedTrace.status === "error"
                        ? "Error trace"
                        : "Slow trace"}
                    </span>
                    <h3>{selectedTrace.name}</h3>
                    <dl>
                      <div>
                        <dt>Trace ID</dt>
                        <dd>{selectedTrace.id}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{selectedTrace.duration}</dd>
                      </div>
                      <div>
                        <dt>Spans</dt>
                        <dd>{selectedTrace.spans}</dd>
                      </div>
                      <div>
                        <dt>Started</dt>
                        <dd>{selectedTrace.startedAt}</dd>
                      </div>
                    </dl>
                    <div className={styles.tracePath}>
                      <span>
                        <i /> edge-gateway <small>91 ms</small>
                      </span>
                      <span className={styles.tracePathCritical}>
                        <i /> checkout-service <small>1.21 s</small>
                      </span>
                      <span>
                        <i /> CheckoutCache.set <small>518 ms</small>
                      </span>
                    </div>
                    <Link href="/#workspace">
                      Open related incident
                      <Icon name="caret-right" size={14} />
                    </Link>
                  </aside>
                ) : null}
              </div>
            ) : (
              <div className={styles.traceEmpty}>
                <Icon name="activity" size={23} />
                <strong>No correlated traces in this window</strong>
                <p>Try a wider time range or select a runtime service.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className={styles.toast} role="status">
          <Icon name="check-circle" size={17} /> {toast}
        </div>
      ) : null}
    </main>
  )
}
