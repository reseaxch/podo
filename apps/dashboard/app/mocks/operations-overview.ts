import type { OperationsOverviewViewModel } from "../lib/operations-overview-types"
import { incidentOverviewMock } from "./incidents"

export const operationsOverviewMock: OperationsOverviewViewModel = {
  owner: incidentOverviewMock.owner,
  generatedAt: "Updated just now",
  incidents: incidentOverviewMock.incidents,
  signals: [
    {
      label: "Evidence pipeline",
      value: "4 / 5 healthy",
      detail: "GitHub Actions needs review",
      tone: "attention",
      href: "/evidence-sources",
    },
    {
      label: "System graph",
      value: "2 unhealthy",
      detail: "8 components observed",
      tone: "critical",
      href: "/system-graph",
    },
    {
      label: "Safety boundary",
      value: "Production locked",
      detail: "1 approval is waiting",
      tone: "healthy",
      href: "/safety",
    },
  ],
  activity: [
    {
      id: "evt-018",
      title: "Pull request #184 created",
      detail: "Verified remediation published for INC-042",
      time: "2 min ago",
      actor: "Podo AI",
      kind: "agent",
      href: "/audit?event=evt-018",
    },
    {
      id: "evt-017",
      title: "Remediation approved",
      detail: "Maya approved the bounded cache patch",
      time: "3 min ago",
      actor: "Maya Chen",
      kind: "human",
      href: "/audit?event=evt-017",
    },
    {
      id: "evt-013",
      title: "Production write blocked",
      detail: "Policy rejected an unavailable capability",
      time: "8 min ago",
      actor: "Podo Core",
      kind: "system",
      href: "/audit?event=evt-013",
    },
  ],
}
