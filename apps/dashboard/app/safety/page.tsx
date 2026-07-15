import type { Metadata } from "next"

import { SafetyApprovals } from "../components/safety/safety-approvals"
import { getSafetyApprovals } from "../lib/safety-data"
import { isDemoDashboard } from "../lib/dashboard-client"

export default async function SafetyPage() {
  const approvals = await getSafetyApprovals()
  return (
    <SafetyApprovals
      initial={approvals}
      source={isDemoDashboard() ? "demo" : "core"}
    />
  )
}
export const metadata: Metadata = { title: "Safety & approvals | Podo" }
