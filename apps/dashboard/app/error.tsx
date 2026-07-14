"use client"

import { useEffect } from "react"

import { IncidentPageState } from "./components/incident-page-state"

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return <IncidentPageState kind="error" onRetry={reset} />
}
