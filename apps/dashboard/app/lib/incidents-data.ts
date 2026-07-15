import type { IncidentOverviewViewModel } from "./incident-overview-types"
import { incidentOverviewMock } from "../mocks/incidents"

export async function getIncidentOverview(): Promise<IncidentOverviewViewModel> {
  return Promise.resolve(incidentOverviewMock)
}
