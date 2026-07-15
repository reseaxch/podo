import { compareTelemetryWindows } from "../plugins/otel-replay/src/index"

const fixtureRoot = new URL("../scenarios/cache-growth/fixtures/", import.meta.url)
const [before, after] = await Promise.all([
  Bun.file(new URL("telemetry.json", fixtureRoot)).json(),
  Bun.file(new URL("telemetry-after-fix.json", fixtureRoot)).json(),
])
const report = compareTelemetryWindows(before, after, {
  service: "checkout-service",
  metricName: "process.heap.used",
  metricUnit: "By",
  stableChangeLimit: 16 * 1024 * 1024,
})

console.log(JSON.stringify(report, null, 2))
if (report.verdict.status !== "stabilized") {
  throw new Error(`Canonical post-fix telemetry did not stabilize: ${report.verdict.status}`)
}
