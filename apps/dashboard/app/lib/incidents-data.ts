import type { IncidentOverviewViewModel } from "./incident-overview-types"
import { incidentOverviewMock } from "../mocks/incidents"

export function getIncidentOverview(): IncidentOverviewViewModel {
  return incidentOverviewMock
}
