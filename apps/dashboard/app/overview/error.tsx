"use client"

import { OperationalPageError } from "../components/operational-page-error"

export default function OverviewError({ reset }: { reset: () => void }) {
  return <OperationalPageError reset={reset} />
}
