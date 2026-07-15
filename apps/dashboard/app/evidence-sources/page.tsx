import type { Metadata } from "next"

import { EvidenceSources } from "../components/evidence-sources/evidence-sources"
import { getEvidenceSources } from "../lib/evidence-sources-data"

export const metadata: Metadata = {
  title: "Evidence Sources | Podo",
  description: "Manage evidence connectors used by Podo investigations.",
}

export default function EvidenceSourcesPage() {
  const model = getEvidenceSources()

  return <EvidenceSources model={model} />
}
