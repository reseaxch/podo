import { incidentMock } from "../mocks/incident"

import type { IncidentWorkspaceViewModel } from "./incident-types"

export async function getIncidentWorkspace(): Promise<IncidentWorkspaceViewModel | null> {
  // This is the only mock boundary. Replace its body with the typed Rootline
  // client when the incident endpoint is available.
  return Promise.resolve(structuredClone(incidentMock))
}
