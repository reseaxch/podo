"use client"

import { useEffect, useRef, useState } from "react"

import { graphNodeDetails, type GraphNodeId } from "../../mocks/incident"
import { Icon } from "../ui/pictogram"

export function GraphView({
  onOpenEvidence,
}: {
  onOpenEvidence: (evidenceId: string) => void
}) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [graphMode, setGraphMode] = useState<"causal" | "all">("causal")
  const [selectedNode, setSelectedNode] = useState<GraphNodeId | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const suppressCanvasClickRef = useRef(false)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const spotlightRef = useRef<HTMLDivElement | null>(null)
  const spotlightFrameRef = useRef<number | null>(null)
  const nodes = [
    ["deploy", "Deploy v2.8.1", "10:02 AM", "Release", "cube"],
    ["heap", "Heap 94%", "10:06 AM", "Metric", "chart-line-up"],
    ["trace", "Latency 812ms", "10:11 AM", "Trace", "git-fork"],
    ["gc", "GC pressure 6×", "10:12 AM", "Runtime", "activity"],
    ["code", "CheckoutCache.set()", "cache.ts:47", "Root cause", "code"],
  ] as const

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setViewport((current) => ({
        ...current,
        scale: Math.min(
          1.65,
          Math.max(0.4, current.scale + (event.deltaY > 0 ? -0.08 : 0.08)),
        ),
      }))
    }
    canvas.addEventListener("wheel", handleWheel, { passive: false })
    return () => {
      canvas.removeEventListener("wheel", handleWheel)
      if (spotlightFrameRef.current !== null)
        window.cancelAnimationFrame(spotlightFrameRef.current)
    }
  }, [])

  function zoomBy(amount: number) {
    setViewport((current) => ({
      ...current,
      scale: Math.min(1.65, Math.max(0.4, current.scale + amount)),
    }))
  }

  function changeGraphMode(mode: "causal" | "all") {
    setGraphMode(mode)
    if (mode === "causal")
      setSelectedNode((current) =>
        current === "traffic" || current === "config" ? null : current,
      )
  }

  function fitGraph() {
    const canvas = canvasRef.current
    const scene = sceneRef.current
    if (!canvas || !scene) return
    const items = Array.from(
      scene.querySelectorAll<HTMLElement>(
        ".graph-node, .ruled-out-node, .context-node",
      ),
    ).filter((item) => item.offsetParent !== null)
    if (!items.length) return
    const bounds = items.reduce(
      (current, item) => {
        const transform = window.getComputedStyle(item).transform
        const matrix =
          transform === "none" ? null : new DOMMatrixReadOnly(transform)
        const left = item.offsetLeft + (matrix?.m41 ?? 0)
        const top = item.offsetTop + (matrix?.m42 ?? 0)
        return {
          left: Math.min(current.left, left),
          top: Math.min(current.top, top),
          right: Math.max(current.right, left + item.offsetWidth),
          bottom: Math.max(current.bottom, top + item.offsetHeight),
        }
      },
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      },
    )
    const padding = Math.min(64, Math.max(24, canvas.clientWidth * 0.04))
    const contentWidth = bounds.right - bounds.left
    const contentHeight = bounds.bottom - bounds.top
    const scale = Math.min(
      1,
      Math.max(
        0.4,
        Math.min(
          (canvas.clientWidth - padding * 2) / contentWidth,
          (canvas.clientHeight - padding * 2) / contentHeight,
        ),
      ),
    )
    setViewport({
      x: scale * (canvas.clientWidth / 2 - (bounds.left + bounds.right) / 2),
      y: scale * (canvas.clientHeight / 2 - (bounds.top + bounds.bottom) / 2),
      scale,
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = window.requestAnimationFrame(fitGraph)
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(fitGraph)
    })
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [graphMode])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add("is-panning")
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
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
    if (!drag || drag.pointerId !== event.pointerId) return
    if (
      Math.abs(event.clientX - drag.startX) > 4 ||
      Math.abs(event.clientY - drag.startY) > 4
    )
      drag.moved = true
    setViewport((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }))
  }

  function clearSelectionFromCanvas(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return
    if (suppressCanvasClickRef.current) {
      suppressCanvasClickRef.current = false
      return
    }
    setSelectedNode(null)
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    suppressCanvasClickRef.current = dragRef.current.moved
    dragRef.current = null
    event.currentTarget.classList.remove("is-panning")
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleGraphKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 24
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
        "0",
      ].includes(event.key)
    )
      event.preventDefault()
    if (event.key === "ArrowLeft")
      setViewport((current) => ({ ...current, x: current.x + step }))
    if (event.key === "ArrowRight")
      setViewport((current) => ({ ...current, x: current.x - step }))
    if (event.key === "ArrowUp")
      setViewport((current) => ({ ...current, y: current.y + step }))
    if (event.key === "ArrowDown")
      setViewport((current) => ({ ...current, y: current.y - step }))
    if (event.key === "+" || event.key === "=") zoomBy(0.1)
    if (event.key === "-") zoomBy(-0.1)
    if (event.key === "0") fitGraph()
  }

  return (
    <section className="graph-view" aria-labelledby="graph-heading">
      <div className="view-heading">
        <div>
          <p className="view-kicker">Evidence-backed causal graph</p>
          <h2 id="graph-heading">Why this is the root cause</h2>
          <p>
            Connects the release to the runtime failure and shows what was ruled
            out.
          </p>
        </div>
        <div className="view-actions">
          <span className="graph-health">
            <i /> Live evidence
          </span>
        </div>
      </div>
      <div className="graph-workspace">
        <div className="graph-toolbar">
          <span>
            <strong>Incident subgraph</strong>
            <small>
              {graphMode === "causal"
                ? "7 nodes · 7 relationships"
                : "9 nodes · 9 relationships"}
            </small>
          </span>
          <div className="graph-toolbar-actions">
            <div className="graph-mode">
              <button
                aria-pressed={graphMode === "causal"}
                onClick={() => changeGraphMode("causal")}
                type="button"
              >
                Causal path
              </button>
              <button
                aria-pressed={graphMode === "all"}
                onClick={() => changeGraphMode("all")}
                type="button"
              >
                All evidence
              </button>
            </div>
            <div className="graph-viewport-controls">
              <button
                aria-label="Zoom out"
                disabled={viewport.scale <= 0.4}
                onClick={() => zoomBy(-0.1)}
                type="button"
              >
                −
              </button>
              <span>{Math.round(viewport.scale * 100)}%</span>
              <button
                aria-label="Zoom in"
                disabled={viewport.scale >= 1.65}
                onClick={() => zoomBy(0.1)}
                type="button"
              >
                +
              </button>
              <button
                aria-label="Fit and center graph"
                className="fit-graph"
                onClick={fitGraph}
                type="button"
              >
                <Icon name="graph" size={13} /> Fit
              </button>
            </div>
          </div>
        </div>
        <div
          aria-label="Causal graph from deployment to root cause. Drag to pan, scroll to zoom."
          className={`causal-canvas graph-mode-${graphMode}`}
          ref={canvasRef}
          onClick={clearSelectionFromCanvas}
          onKeyDown={handleGraphKeyDown}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="application"
          tabIndex={0}
        >
          <div
            aria-hidden="true"
            className="graph-spotlight"
            ref={spotlightRef}
          />
          <div
            className="graph-scene"
            ref={sceneRef}
            style={{
              transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
            }}
          >
            <svg
              aria-hidden="true"
              className="graph-edges"
              viewBox="0 0 760 350"
              preserveAspectRatio="none"
            >
              <path d="M128 178 C182 178 188 93 252 93" />
              <path d="M353 93 C408 93 405 93 456 93" />
              <path d="M353 93 C405 93 408 253 456 253" />
              <path d="M559 93 C620 93 620 178 674 178" />
              <path d="M559 253 C620 253 620 178 674 178" />
            </svg>
            <svg
              aria-hidden="true"
              className="graph-edges exclusion-edges"
              viewBox="0 0 760 350"
              preserveAspectRatio="none"
            >
              <path d="M100 315 C92 260 105 220 128 178" />
              <path d="M260 315 C330 315 385 275 456 253" />
            </svg>
            {graphMode === "all" ? (
              <svg
                aria-hidden="true"
                className="graph-edges context-edges"
                viewBox="0 0 760 350"
                preserveAspectRatio="none"
              >
                <path d="M105 35 C150 35 195 65 252 93" />
                <path d="M655 35 C690 65 690 120 674 178" />
              </svg>
            ) : null}
            <span
              aria-label="Precedes by 4 minutes"
              className="edge-label edge-one"
              title="Precedes by 4 minutes"
            >
              4m later
            </span>
            <span
              aria-label="Correlation 0.94"
              className="edge-label edge-two"
              title="Correlation 0.94"
            >
              r = .94
            </span>
            <span className="edge-label edge-three">retained heap</span>
            <span
              aria-label="Dominant trace span"
              className="edge-label edge-four"
              title="Dominant trace span"
            >
              top span
            </span>
            {nodes.map(([id, label, time, kind, icon]) => (
              <button
                aria-pressed={selectedNode === id}
                className={`graph-node node-${id} ${id === "code" ? "root-cause" : ""}`}
                key={id}
                onClick={() => setSelectedNode(id)}
                type="button"
              >
                <span className="graph-node-icon">
                  <Icon name={icon} size={18} />
                </span>
                <span>
                  <small>{kind}</small>
                  <strong>{label}</strong>
                  <em>{time} · Verified</em>
                </span>
              </button>
            ))}
            <button
              aria-pressed={selectedNode === "flags"}
              className="ruled-out-node node-flags"
              onClick={() => setSelectedNode("flags")}
              type="button"
            >
              <Icon name="flag" size={15} />
              <span>
                <strong>Feature flags</strong>
                <small>Ruled out</small>
              </span>
            </button>
            <button
              aria-pressed={selectedNode === "infra"}
              className="ruled-out-node node-infra"
              onClick={() => setSelectedNode("infra")}
              type="button"
            >
              <Icon name="stack" size={15} />
              <span>
                <strong>Infrastructure</strong>
                <small>Healthy</small>
              </span>
            </button>
            {graphMode === "all" ? (
              <>
                <button
                  aria-pressed={selectedNode === "traffic"}
                  className="context-node node-traffic"
                  onClick={() => setSelectedNode("traffic")}
                  type="button"
                >
                  <Icon name="trend-up" size={15} />
                  <span>
                    <strong>Traffic volume</strong>
                    <small>Within baseline</small>
                  </span>
                </button>
                <button
                  aria-pressed={selectedNode === "config"}
                  className="context-node node-config"
                  onClick={() => setSelectedNode("config")}
                  type="button"
                >
                  <Icon name="gear-six" size={15} />
                  <span>
                    <strong>Runtime config</strong>
                    <small>No changes</small>
                  </span>
                </button>
              </>
            ) : null}
          </div>
          <span className="pan-hint">
            <Icon name="share-network" size={14} /> Drag to pan · scroll to zoom
          </span>
        </div>
        {selectedNode ? (
          <section aria-live="polite" className="graph-inspector">
            <header>
              <span>
                <small>{graphNodeDetails[selectedNode].kind}</small>
                <strong>{graphNodeDetails[selectedNode].title}</strong>
                <em>{graphNodeDetails[selectedNode].status}</em>
              </span>
              <button
                aria-label="Close node details"
                onClick={() => setSelectedNode(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div>
              <small>Why it matters</small>
              <p>{graphNodeDetails[selectedNode].why}</p>
            </div>
            <div>
              <small>Evidence snapshot</small>
              <strong>{graphNodeDetails[selectedNode].evidence}</strong>
              <em>{graphNodeDetails[selectedNode].relation}</em>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                onOpenEvidence(graphNodeDetails[selectedNode].evidenceId)
              }
              type="button"
            >
              Open evidence <Icon name="arrow-square-out" size={14} />
            </button>
          </section>
        ) : null}
        {graphMode === "causal" ? (
          <div className="graph-proof-row" aria-label="Causal proof summary">
            <span>
              <small>Trigger</small>
              <strong>Deploy v2.8.1</strong>
              <em>Anomaly starts 4m later</em>
            </span>
            <b>→</b>
            <span>
              <small>Mechanism</small>
              <strong>Unbounded cache retention</strong>
              <em>Heap 94% · GC pressure 6×</em>
            </span>
            <b>→</b>
            <span>
              <small>Root cause</small>
              <strong>CheckoutCache.set()</strong>
              <em>Dominant trace contributor</em>
            </span>
          </div>
        ) : (
          <div
            className="graph-coverage-row"
            aria-label="Evidence coverage summary"
          >
            <span>
              <small>Causal path</small>
              <strong>5 verified nodes</strong>
              <em>Trigger → mechanism → cause</em>
            </span>
            <span>
              <small>Supporting context</small>
              <strong>2 baseline checks</strong>
              <em>Traffic and runtime config</em>
            </span>
            <span>
              <small>Ruled out</small>
              <strong>2 alternatives</strong>
              <em>Flags and infrastructure</em>
            </span>
            <span>
              <small>Coverage</small>
              <strong>9 / 9 mapped</strong>
              <em>No orphaned evidence</em>
            </span>
          </div>
        )}
        <footer className="graph-legend">
          <span>
            <i className="legend-causal" /> Causal evidence
          </span>
          <span>
            <i className="legend-root" /> Probable root cause
          </span>
          {graphMode === "all" ? (
            <span>
              <i className="legend-context" /> Supporting context
            </span>
          ) : null}
          <span>
            <i className="legend-ruled" /> Ruled out
          </span>
          <strong>Confidence 87%</strong>
        </footer>
      </div>
    </section>
  )
}
