import type { Metadata } from "next"

import { OperationsOverview } from "../components/overview/operations-overview"
import { getOperationsOverview } from "../lib/operations-overview-data"
import { isDemoDashboard } from "../lib/dashboard-client"

export default async function OverviewPage() {
  return (
    <OperationsOverview
      overview={await getOperationsOverview()}
      source={isDemoDashboard() ? "demo" : "core"}
    />
  )
}
export const metadata: Metadata = { title: "Overview | Podo" }
