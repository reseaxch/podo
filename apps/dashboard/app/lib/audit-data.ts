import { auditLogMock } from "../mocks/audit"
import type { AuditLogViewModel } from "./audit-types"

export function getAuditLog(): AuditLogViewModel {
  return auditLogMock
}
