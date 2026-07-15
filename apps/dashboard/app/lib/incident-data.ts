import { incidentMock } from "../mocks/incident"

import type { IncidentWorkspaceViewModel } from "./incident-types"

export function getIncidentWorkspace(): IncidentWorkspaceViewModel | null {
  // This is the only mock boundary. Replace its body with the typed Rootline
  // client when the incident endpoint is available.
  return structuredClone(incidentMock)
}
