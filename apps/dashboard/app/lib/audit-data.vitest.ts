import type { BuildIncidentAuditEvent } from "@podo/contracts"
import { describe, expect, it } from "vitest"

import { adaptCoreAuditEvent } from "./audit-data"

describe("adaptCoreAuditEvent", () => {
  it("includes Build incident approvals in the global audit model", () => {
    const event: BuildIncidentAuditEvent = {
      sequence: 4,
      occurredAt: "2026-07-16T10:10:00.000Z",
      incidentId: "build:owner/repo:1042:1",
      kind: "build.retry_approval_decided",
      retryId: "retry-1",
      approvalId: "approval-1",
      decision: "approve",
      decidedBy: "operator-1",
    }

    expect(adaptCoreAuditEvent(event, "dashboard")).toMatchObject({
      category: "Approval",
      outcome: "Success",
      incidentId: event.incidentId,
      service: "dashboard",
      action: event.kind,
      source: "Podo Core API",
    })
  })
})
