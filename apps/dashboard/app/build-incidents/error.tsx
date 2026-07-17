"use client"

import { OperationalPageError } from "../components/operational-page-error"

export default function BuildIncidentsError({ reset }: { reset: () => void }) {
  return <OperationalPageError reset={reset} />
}
