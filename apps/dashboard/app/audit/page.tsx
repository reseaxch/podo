import { AuditLog } from "../components/audit/audit-log"
import { getAuditLog } from "../lib/audit-data"

export default function AuditPage() {
  const audit = getAuditLog()
  return <AuditLog audit={audit} />
}
