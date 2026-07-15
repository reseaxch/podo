import type { Metadata } from "next"

import { EvidenceSources } from "../components/evidence-sources/evidence-sources"
import { getEvidenceSources } from "../lib/evidence-sources-data"
import { isDemoDashboard } from "../lib/dashboard-client"

export const metadata: Metadata = {
  title: "Evidence Sources | Podo",
  description: "Manage evidence connectors used by Podo investigations.",
}

export default async function EvidenceSourcesPage() {
  const model = await getEvidenceSources()

  return <EvidenceSources model={model} readOnly={!isDemoDashboard()} />
}
