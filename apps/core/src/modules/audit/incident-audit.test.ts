import { describe, expect, test } from "bun:test"

import { IncidentAuditStore } from "./incident-audit"

describe("IncidentAuditStore", () => {
  test("takes an immutable snapshot of nested event payload", () => {
    const store = new IncidentAuditStore()
    const evidenceIds = ["ev:1", "ev:2"]

    store.append("incident-owned", {
      kind: "investigation.diagnosis_validated",
      investigationId: "investigation-owned",
      evidenceIds,
    })
    evidenceIds[0] = "ev:mutated"
    const readEvent = store.get("incident-owned")[0]!
    if (readEvent.kind !== "investigation.diagnosis_validated") throw new Error("expected diagnosis event")
    readEvent.evidenceIds = ["ev:read-mutation"]

    expect(store.get("incident-owned")).toMatchObject([{
      incidentId: "incident-owned",
      investigationId: "investigation-owned",
      evidenceIds: ["ev:1", "ev:2"],
    }])
  })

  test("rejects runtime-cast attempts to override Core metadata", () => {
    const store = new IncidentAuditStore()

    expect(() => store.append("incident-owned", {
      kind: "investigation.requested",
      incidentId: "incident-attacker",
      sequence: 999,
      occurredAt: "2000-01-01T00:00:00.000Z",
    } as never)).toThrow("invalid_incident_audit_event")
    expect(store.get("incident-owned")).toEqual([])
    expect(store.get("incident-attacker")).toEqual([])
  })

  test("accepts only bounded redacted tool summaries", () => {
    const store = new IncidentAuditStore()
    store.append("incident-owned", {
      kind: "investigation.tool_step",
      investigationId: "investigation-owned",
      stepId: "step-owned",
      tool: "command",
      status: "started",
      inputSummary: "Command content withheld (42 characters).",
    })

    expect(() => store.append("incident-owned", {
      kind: "investigation.tool_step",
      investigationId: "investigation-owned",
      stepId: "step-private",
      tool: "command",
      status: "failed",
      inputSummary: "Authorization: Bearer private-token",
      outputSummary: "private provider output",
    } as never)).toThrow("invalid_incident_audit_event")
    expect(JSON.stringify(store.get("incident-owned"))).not.toContain("private")
  })

  test("tool noise preserves investigation milestones and reports bounded history loss", () => {
    const store = new IncidentAuditStore()
    store.append("incident-owned", { kind: "investigation.requested" })
    store.append("incident-owned", {
      kind: "investigation.started",
      investigationId: "investigation-owned",
    })
    for (let index = 0; index < 260; index += 1) {
      store.append("incident-owned", {
        kind: "investigation.tool_step",
        investigationId: "investigation-owned",
        stepId: `step-${index}`,
        tool: "command",
        status: "started",
        inputSummary: "Command content withheld (42 characters).",
      })
    }
    store.append("incident-owned", {
      kind: "investigation.completed",
      investigationId: "investigation-owned",
    })

    const audit = store.read("incident-owned")
    expect(audit.events).toHaveLength(256)
    expect(audit.events.filter(({ kind }) => kind === "investigation.requested")).toHaveLength(1)
    expect(audit.events.filter(({ kind }) => kind === "investigation.started")).toHaveLength(1)
    expect(audit.events.filter(({ kind }) => kind === "investigation.completed")).toHaveLength(1)
    expect(audit.retention).toEqual({ truncatedToolSteps: 7 })
    expect(audit.events.at(-1)?.sequence).toBe(263)
    expect(audit.events.every((event, index, events) => index === 0 || event.sequence > events[index - 1]!.sequence)).toBe(true)
  })

  test("keeps one immutable monotonic audit for Build Incident evidence and CI verification", () => {
    const store = new IncidentAuditStore()
    const evidenceIds = ["build_evidence_a", "build_evidence_b"]

    store.append("build-incident", {
      kind: "build.signal_received",
      deliveryId: "delivery-1",
      runId: 91377001,
      runAttempt: 1,
      headSha: "c".repeat(40),
    })
    store.append("build-incident", { kind: "build.evidence_captured", evidenceIds })
    store.append("build-incident", { kind: "build.incident_created" })
    store.append("build-incident", {
      kind: "build.retry_ci_result_observed",
      retryId: "retry-1",
      runId: 91377001,
      runAttempt: 2,
      headSha: "c".repeat(40),
      status: "completed",
      conclusion: "success",
    })
    store.append("build-incident", {
      kind: "build.retry_verified",
      retryId: "retry-1",
      runId: 91377001,
      runAttempt: 2,
    })
    evidenceIds[0] = "mutated"

    const events = store.getBuild("build-incident")
    expect(events.map(({ sequence, kind }) => ({ sequence, kind }))).toEqual([
      { sequence: 1, kind: "build.signal_received" },
      { sequence: 2, kind: "build.evidence_captured" },
      { sequence: 3, kind: "build.incident_created" },
      { sequence: 4, kind: "build.retry_ci_result_observed" },
      { sequence: 5, kind: "build.retry_verified" },
    ])
    expect(events[1]).toMatchObject({ evidenceIds: ["build_evidence_a", "build_evidence_b"] })
  })

  test("rejects malformed Build Incident audit values without leaking them into the log", () => {
    const store = new IncidentAuditStore()

    expect(() => store.append("build-incident", {
      kind: "build.retry_ci_result_observed",
      retryId: "retry-1",
      runId: 91377001,
      runAttempt: 2,
      headSha: "foreign-provider-output",
      status: "completed",
      conclusion: "success",
    } as never)).toThrow("invalid_incident_audit_event")
    expect(store.getBuild("build-incident")).toEqual([])
  })
})
