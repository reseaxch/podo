import type { Metadata } from "next"

import { AuditLog } from "../components/audit/audit-log"
import { getAuditLog } from "../lib/audit-data"

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>
}) {
  const audit = await getAuditLog()
  const { event } = await searchParams
  return <AuditLog audit={audit} initialEventId={event} />
}
export const metadata: Metadata = { title: "Audit log | Podo" }
