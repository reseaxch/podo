// Deterministic generator for the cache-growth recorded telemetry fixture.
//
// Produces a normalized OpenTelemetry-compatible event stream that reproduces
// the incident: a deployment removes the checkout cache bound, heap usage climbs
// monotonically, then the endpoint starts returning HTTP 500 with traces.
//
// Every event conforms to @podo/contracts TelemetryEvent so the otel-replay
// adapter and domain normalizer accept it unchanged. Output is fully
// deterministic (fixed base time, fixed step, no randomness) so the replay is
// reproducible per FR-2.
//
// The event construction and serialization are pure, exported functions so a
// fixture-integrity test can regenerate the stream in memory without touching
// the filesystem. The CLI (writing fixtures/telemetry.json) runs only under the
// `import.meta.main` guard, so importing this module never writes the fixture.
//
// Run: bun run scenarios/cache-growth/generate-telemetry.ts

export interface TelemetryEvent {
  timestamp: string
  kind: "log" | "trace" | "metric"
  service: string
  severity: "debug" | "info" | "warn" | "error" | "critical"
  message: string
  deploymentId?: string
  traceId?: string
  containerId?: string
  metric?: { name: string; value: number; unit?: string }
}

const SERVICE = "checkout-service"
const CONTAINER = "checkout-service-7b9c"
const HEALTHY_DEPLOY = "deploy-1041" // pre-defect
const DEFECT_DEPLOY = "deploy-1042" // introduces the unbounded cache
const BASE_MS = Date.parse("2026-07-14T09:00:00.000Z")
const STEP_MS = 15_000 // 15s between samples
const HEALTHY_SAMPLES = 4 // heap samples before the defect deployment
const DEFECT_AT = HEALTHY_SAMPLES // tick index of the defect deployment marker

function at(step: number): string {
  return new Date(BASE_MS + step * STEP_MS).toISOString()
}

function heap(step: number, deployment: string): TelemetryEvent {
  // Healthy: flat ~180MB. After defect deploy: linear climb from 180MB.
  const baselineMb = 180
  const isDefect = deployment === DEFECT_DEPLOY
  const climb = isDefect ? (step - DEFECT_AT) * 42 : 0
  const usedBytes = Math.round((baselineMb + climb) * 1024 * 1024)
  return {
    timestamp: at(step),
    kind: "metric",
    service: SERVICE,
    severity: usedBytes > 900 * 1024 * 1024 ? "warn" : "info",
    message: "process heap sample",
    deploymentId: deployment,
    containerId: CONTAINER,
    metric: { name: "process.heap.used", value: usedBytes, unit: "By" },
  }
}

/**
 * Deterministically builds the cache-growth telemetry event stream in memory.
 * Pure: no I/O, no clock, no randomness — the same input always yields the same
 * events in the same order.
 */
export function buildTelemetryEvents(): TelemetryEvent[] {
  const events: TelemetryEvent[] = []
  let tick = 0

  // --- Phase 1: healthy baseline (pre-defect deployment) ---
  for (let i = 0; i < HEALTHY_SAMPLES; i += 1) {
    events.push(heap(tick, HEALTHY_DEPLOY))
    tick += 1
  }

  // --- Phase 2: defect deployment marker ---
  events.push({
    timestamp: at(tick),
    kind: "log",
    service: SERVICE,
    severity: "info",
    message: `deployment ${DEFECT_DEPLOY} rolled out`,
    deploymentId: DEFECT_DEPLOY,
    containerId: CONTAINER,
  })
  tick += 1

  // --- Phase 3: heap climbs monotonically after the defect ---
  for (let i = 0; i < 8; i += 1) {
    events.push(heap(tick, DEFECT_DEPLOY))
    tick += 1
  }

  // --- Phase 4: HTTP 500s begin, with correlated traces ---
  for (let i = 0; i < 3; i += 1) {
    const traceId = `trace-${(i + 1).toString().padStart(4, "0")}`
    events.push({
      timestamp: at(tick),
      kind: "trace",
      service: SERVICE,
      severity: "error",
      message: "POST /checkout returned 500",
      deploymentId: DEFECT_DEPLOY,
      containerId: CONTAINER,
      traceId,
    })
    events.push({
      timestamp: at(tick),
      kind: "log",
      service: SERVICE,
      severity: "error",
      message: "allocation failure handling /checkout: JavaScript heap out of memory",
      deploymentId: DEFECT_DEPLOY,
      containerId: CONTAINER,
      traceId,
    })
    events.push(heap(tick, DEFECT_DEPLOY))
    tick += 1
  }

  return events
}

/**
 * Serializes telemetry events to the exact on-disk fixture form: 2-space
 * pretty-printed JSON with a trailing newline.
 */
export function serializeTelemetry(events: TelemetryEvent[]): string {
  return `${JSON.stringify(events, null, 2)}\n`
}

// CLI: writes the fixture. Guarded so importing this module never writes to disk.
if (import.meta.main) {
  const { writeFileSync } = await import("node:fs")
  const { fileURLToPath } = await import("node:url")
  const { dirname, join } = await import("node:path")

  const events = buildTelemetryEvents()
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
  const outPath = join(outDir, "telemetry.json")
  writeFileSync(outPath, serializeTelemetry(events))
  console.log(`Wrote ${events.length} events to ${outPath}`)
}
