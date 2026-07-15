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
const FIXED_DEPLOY = "deploy-1043" // post-fix: bounds the cache again
const BASE_MS = Date.parse("2026-07-14T09:00:00.000Z")
const STEP_MS = 15_000 // 15s between samples
const HEALTHY_SAMPLES = 4 // heap samples before the defect deployment
const DEFECT_AT = HEALTHY_SAMPLES // tick index of the defect deployment marker
// The after-fix stream is generated on its own fixed timeline, offset so its
// timestamps never collide with the incident stream.
const AFTER_FIX_BASE_MS = Date.parse("2026-07-14T10:00:00.000Z")
const AFTER_FIX_SAMPLES = 12 // bounded heap samples after the fix deployment

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
 * Deterministically builds the POST-FIX cache-growth telemetry stream in memory.
 *
 * This is the "after" side of the before/after comparison: the fix deployment
 * (`deploy-1043`) restores the cache bound, so heap usage stays flat/bounded and
 * the stream contains no HTTP 500 traces and no out-of-memory logs. Like the
 * incident stream it is pure and fully deterministic.
 */
export function buildAfterFixTelemetryEvents(): TelemetryEvent[] {
  const events: TelemetryEvent[] = []
  const at = (step: number): string =>
    new Date(AFTER_FIX_BASE_MS + step * STEP_MS).toISOString()

  // Post-fix deployment marker.
  events.push({
    timestamp: at(0),
    kind: "log",
    service: SERVICE,
    severity: "info",
    message: `deployment ${FIXED_DEPLOY} rolled out`,
    deploymentId: FIXED_DEPLOY,
    containerId: CONTAINER,
  })

  // Bounded heap: flat ~180MB, never climbing. No 500s, no OOM logs.
  const boundedMb = 180
  const usedBytes = Math.round(boundedMb * 1024 * 1024)
  for (let i = 1; i <= AFTER_FIX_SAMPLES; i += 1) {
    events.push({
      timestamp: at(i),
      kind: "metric",
      service: SERVICE,
      severity: "info",
      message: "process heap sample",
      deploymentId: FIXED_DEPLOY,
      containerId: CONTAINER,
      metric: { name: "process.heap.used", value: usedBytes, unit: "By" },
    })
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

// CLI: writes a fixture. Guarded so importing this module never writes to disk.
//
//   bun run scenarios/cache-growth/generate-telemetry.ts             → telemetry.json (incident)
//   bun run scenarios/cache-growth/generate-telemetry.ts --after-fix → telemetry-after-fix.json (post-fix)
//
// Each mode writes only its own file; it never touches the other fixture.
if (import.meta.main) {
  const { writeFileSync } = await import("node:fs")
  const { fileURLToPath } = await import("node:url")
  const { dirname, join } = await import("node:path")

  const afterFix = process.argv.includes("--after-fix")
  const events = afterFix ? buildAfterFixTelemetryEvents() : buildTelemetryEvents()
  const fileName = afterFix ? "telemetry-after-fix.json" : "telemetry.json"

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
  const outPath = join(outDir, fileName)
  writeFileSync(outPath, serializeTelemetry(events))
  console.log(`Wrote ${events.length} events to ${outPath}`)
}
