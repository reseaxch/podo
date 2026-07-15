import type { Metadata } from "next"

import { OperationsOverview } from "../components/overview/operations-overview"
import { getOperationsOverview } from "../lib/operations-overview-data"

export default async function OverviewPage() {
  return <OperationsOverview overview={await getOperationsOverview()} />
}
export const metadata: Metadata = { title: "Overview | Podo" }
