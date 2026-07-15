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
})
