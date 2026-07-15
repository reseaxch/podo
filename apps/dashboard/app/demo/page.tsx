import { DemoIncidentWorkspace } from "../components/demo-incident-workspace"
import { incidentMock } from "../mocks/incident"

export default function DemoPage() {
  return <DemoIncidentWorkspace incident={incidentMock} />
}
