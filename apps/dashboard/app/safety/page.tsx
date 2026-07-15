import { SafetyApprovals } from "../components/safety/safety-approvals"
import { getSafetyApprovals } from "../lib/safety-data"

export default function SafetyPage() {
  const approvals = getSafetyApprovals()
  return <SafetyApprovals initial={approvals} />
}
