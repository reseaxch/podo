import { createRootlineClient, type RootlineClient } from "@rootline/client"
import type { DetectedIncident, RootlineSettings, SystemStatusResponse } from "@rootline/contracts"
import { useEffect, useMemo, useState } from "react"

import {
  RootlineTui,
  type RootlineTuiController,
  type RootlineTuiViewModel,
  type TuiSettings,
} from "./app"

const initialViewModel: RootlineTuiViewModel = {
  status: "loading",
  statusDetail: "Connecting to core",
  evidence: [],
  settings: {
    mode: "observe",
    monitoringEnabled: true,
    sandbox: "read-only",
    timeoutSeconds: 60,
  },
}

export function toTuiSettings(settings: RootlineSettings): TuiSettings {
  return {
    mode: settings.autonomyMode,
    monitoringEnabled: settings.monitoringEnabled,
    sandbox: settings.defaultSandbox,
    timeoutSeconds: settings.turnTimeoutMs / 1_000,
  }
}

export function toRootlineSettings(settings: TuiSettings): RootlineSettings {
  return {
    autonomyMode: settings.mode,
    monitoringEnabled: settings.monitoringEnabled,
    defaultSandbox: settings.sandbox,
    turnTimeoutMs: settings.timeoutSeconds * 1_000,
  }
}

export function toTuiViewModel(
  system: SystemStatusResponse,
  settings: RootlineSettings,
  incidents: readonly DetectedIncident[],
): RootlineTuiViewModel {
  const latest = incidents.at(-1)
  return {
    status: system.status === "ready" ? "idle" : "degraded",
    statusDetail: system.status === "ready"
      ? "Core and Codex are ready"
      : system.codex.error ?? "Codex runtime is unavailable",
    ...(latest ? { incidentTitle: `${latest.affectedService} · ${latest.detector}` } : {}),
    evidence: latest?.evidence.map((item) => `${item.sourceType}: ${item.sourceEventId}`) ?? [],
    settings: toTuiSettings(settings),
  }
}

export function ConnectedRootlineTui({
  coreUrl,
  client: injectedClient,
}: {
  coreUrl: string
  client?: RootlineClient
}) {
  const client = useMemo(
    () => injectedClient ?? createRootlineClient({ baseUrl: coreUrl }),
    [coreUrl, injectedClient],
  )
  const [viewModel, setViewModel] = useState<RootlineTuiViewModel>(initialViewModel)

  useEffect(() => {
    let active = true
    void Promise.all([client.systemStatus(), client.getSettings(), client.listIncidents()])
      .then(([system, settings, incidents]) => {
        if (active) setViewModel(toTuiViewModel(system, settings.settings, incidents.incidents))
      })
      .catch((cause: unknown) => {
        if (!active) return
        setViewModel((current) => ({
          ...current,
          status: "degraded",
          statusDetail: cause instanceof Error ? cause.message : String(cause),
        }))
      })
    return () => {
      active = false
    }
  }, [client])

  const controller = useMemo<RootlineTuiController>(() => ({
    approve() {
      setViewModel((current) => ({ ...current, status: "degraded", statusDetail: "No active investigation selected" }))
    },
    deny() {
      setViewModel((current) => ({ ...current, status: "degraded", statusDetail: "No active investigation selected" }))
    },
    cancel() {
      setViewModel((current) => ({ ...current, status: "degraded", statusDetail: "No active investigation selected" }))
    },
    saveSettings(settings) {
      void client.updateSettings(toRootlineSettings(settings))
        .then((response) => {
          setViewModel((current) => ({ ...current, settings: toTuiSettings(response.settings) }))
        })
        .catch((cause: unknown) => {
          setViewModel((current) => ({
            ...current,
            status: "degraded",
            statusDetail: cause instanceof Error ? cause.message : String(cause),
          }))
        })
    },
  }), [client])

  return <RootlineTui coreUrl={coreUrl} controller={controller} viewModel={viewModel} />
}
