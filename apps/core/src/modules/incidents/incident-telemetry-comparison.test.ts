import { expect, test } from "bun:test"
import type {
  TelemetryEventInput,
  VerifiedIncidentPostFixReplay,
} from "@podo/contracts"

import {
  IncidentTelemetryComparisonService,
} from "./incident-telemetry-comparison"
import { IncidentMonitor } from "./incident-monitor"

const HEAD = "d".repeat(40)
const MIB = 1024 * 1024

test("fails custom replay sources closed on oversized or non-normalized events", () => {
  const monitor = new IncidentMonitor()
  const start = Date.parse("2026-07-14T09:00:00.000Z")
  const before: TelemetryEventInput[] = [
    ...[180, 310, 450, 620].map((mib, step) => ({
      timestamp: new Date(start + step * 1_000).toISOString(),
      kind: "metric" as const,
      service: "checkout-service",
      severity: "warn" as const,
      message: "process heap sample",
      deploymentId: "deploy-bad",
      metric: {
        name: "process.heap.used",
        value: mib * MIB,
        unit: "By",
      },
    })),
    {
      timestamp: new Date(start + 4_000).toISOString(),
      kind: "trace",
      service: "checkout-service",
      severity: "error",
      message: "POST /checkout returned 500",
      deploymentId: "deploy-bad",
      traceId: "trace-1",
    },
    {
      timestamp: new Date(start + 5_000).toISOString(),
      kind: "log",
      service: "checkout-service",
      severity: "error",
      message: "JavaScript heap out of memory",
      deploymentId: "deploy-bad",
      traceId: "trace-2",
    },
  ]
  const detected = monitor.ingest(before)
  if (!detected.incident) throw new Error("expected incident")
  const validAfter: TelemetryEventInput = {
    timestamp: "2026-07-14T10:00:00.000Z",
    kind: "metric",
    service: "checkout-service",
    severity: "info",
    message: "process heap sample",
    deploymentId: "deploy-fixed",
    commitId: HEAD,
    metric: {
      name: "process.heap.used",
      value: 180 * MIB,
      unit: "By",
    },
  }
  const base: VerifiedIncidentPostFixReplay = {
    replayId: `replay_${"a".repeat(24)}`,
    incidentId: detected.incident.id,
    remediationId: "remediation_1",
    artifactId: "artifact_1",
    headSha: HEAD,
    events: [validAfter],
  }
  const deliveries = {
    getTrustedDelivery: () => ({
      remediationId: base.remediationId,
      artifactId: base.artifactId,
      headSha: base.headSha,
    }),
  }

  for (const replay of [
    { ...base, events: Array.from({ length: 1_001 }, () => validAfter) },
    {
      ...base,
      events: [{ ...validAfter, message: "x".repeat(2_001) }],
    },
    {
      ...base,
      events: [{
        ...validAfter,
        timestamp: "2026-07-14T11:00:00.000+01:00",
      }],
    },
  ]) {
    const result = new IncidentTelemetryComparisonService(
      monitor,
      deliveries,
      { getVerifiedReplay: () => replay },
    ).read(detected.incident.id)

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: "comparison_unavailable",
    })
  }

  expect(
    new IncidentTelemetryComparisonService(
      monitor,
      deliveries,
      {
        getVerifiedReplay() {
          throw new Error("custom replay source failed")
        },
      },
    ).read(detected.incident.id),
  ).toEqual({
    ok: false,
    status: 409,
    error: "comparison_unavailable",
    message:
      "Comparable post-fix telemetry is not available for this incident",
  })

  const reorderedAfter = {
    metric: {
      unit: "By",
      value: 180 * MIB,
      name: "process.heap.used",
    },
    commitId: HEAD,
    deploymentId: "deploy-fixed",
    message: "process heap sample",
    severity: "info" as const,
    service: "checkout-service",
    kind: "metric" as const,
    timestamp: "2026-07-14T10:00:00.000Z",
  }
  const reordered = new IncidentTelemetryComparisonService(
    monitor,
    deliveries,
    {
      getVerifiedReplay: () => ({
        ...base,
        events: [reorderedAfter],
      }),
    },
  ).read(detected.incident.id)

  expect(reordered).toMatchObject({
    ok: true,
    comparison: {
      verdict: { status: "stabilized" },
    },
  })
})
