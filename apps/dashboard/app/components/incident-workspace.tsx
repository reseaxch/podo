"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useToast } from "../hooks/use-toast"
import type {
  IncidentController,
  IncidentTab,
  IncidentWorkspaceViewModel,
} from "../lib/incident-types"
import type { GraphNodeId } from "../mocks/incident"
import { ChangesView } from "./incident/changes-view"
import { CoreChangesView } from "./incident/core-changes-view"
import { CoreGraphView } from "./incident/core-graph-view"
import { DiagnosisLauncher, DiagnosisPanel } from "./incident/diagnosis-panel"
import { EvidenceView } from "./incident/evidence-view"
import { GraphView } from "./incident/graph-view"
import { IncidentHeader } from "./incident/incident-header"
import { IconRail } from "./shell/icon-rail"
import { Topbar } from "./shell/topbar"
import { Icon } from "./ui/pictogram"

export function IncidentWorkspace({
  controller,
  incident,
  initialGraphNodeId,
  initialTab = "evidence",
}: {
  controller: IncidentController
  incident: IncidentWorkspaceViewModel
  initialGraphNodeId?: GraphNodeId | undefined
  initialTab?: IncidentTab
}) {
  const [tabSelection, setTabSelection] = useState({
    initialTab,
    selected: initialTab,
  })
  const activeTab =
    tabSelection.initialTab === initialTab ? tabSelection.selected : initialTab
  const setActiveTab = useCallback(
    (selected: IncidentTab) => setTabSelection({ initialTab, selected }),
    [initialTab],
  )
  const [expandedId, setExpandedId] = useState<string | null>(() =>
    incident.graph ? (incident.evidence[0]?.id ?? null) : "trace",
  )
  const [diagnosisOpen, setDiagnosisOpen] = useState(true)
  const [compactDiagnosis, setCompactDiagnosis] = useState(false)
  const [query, setQuery] = useState("")
  const compactLayoutRef = useRef<boolean | null>(null)
  const shellRef = useRef<HTMLElement | null>(null)
  const { toast, toastState, showToast } = useToast()

  const filteredEvidence = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return incident.evidence
    return incident.evidence.filter((item) =>
      `${item.source} ${item.provider} ${item.finding} ${item.detail}`
        .toLowerCase()
        .includes(normalized),
    )
  }, [incident.evidence, query])

  const openEvidence = useCallback(
    (id: string) => {
      setActiveTab("evidence")
      setExpandedId(id)
    },
    [setActiveTab],
  )
  const closeDiagnosis = useCallback(() => setDiagnosisOpen(false), [])
  const openDiagnosis = useCallback(() => {
    setDiagnosisOpen(true)
    showToast("Working diagnosis opened")
  }, [showToast])

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1120px)")
    const updateLayout = () => {
      if (compactLayoutRef.current === media.matches) return
      compactLayoutRef.current = media.matches
      setCompactDiagnosis(media.matches)
      if (media.matches) setDiagnosisOpen(false)
    }
    updateLayout()
    media.addEventListener("change", updateLayout)
    return () => media.removeEventListener("change", updateLayout)
  }, [])

  useEffect(() => {
    shellRef.current?.setAttribute("data-ready", "true")
  }, [])

  return (
    <main className="app-shell" ref={shellRef}>
      <IconRail />
      <Topbar
        current={incident.id}
        onNotify={showToast}
        onNotificationOpen={(id, message) => {
          openEvidence(id)
          showToast(message)
        }}
        onQueryChange={(value) => {
          setQuery(value)
          if (value) setActiveTab("evidence")
        }}
        owner={incident.owner}
        query={query}
        searchLabel="Search evidence"
        searchPlaceholder="Search evidence..."
      />
      <section className="workspace" id="workspace">
        <IncidentHeader
          controller={controller}
          incident={incident}
          onNotify={showToast}
        />
        <div
          className={`workspace-body ${diagnosisOpen ? "" : "diagnosis-collapsed"}`}
        >
          <section className="investigation-panel">
            <div className="tabs" role="tablist" aria-label="Incident views">
              <button
                aria-selected={activeTab === "evidence"}
                onClick={() => setActiveTab("evidence")}
                onMouseDown={(event) => event.preventDefault()}
                role="tab"
                type="button"
              >
                <Icon name="list-bullets" size={17} /> Evidence
              </button>
              <button
                aria-selected={activeTab === "graph"}
                onClick={() => setActiveTab("graph")}
                onMouseDown={(event) => event.preventDefault()}
                role="tab"
                type="button"
              >
                <Icon name="graph" size={17} /> Graph
              </button>
              <button
                aria-selected={activeTab === "changes"}
                onClick={() => setActiveTab("changes")}
                onMouseDown={(event) => event.preventDefault()}
                role="tab"
                type="button"
              >
                <Icon name="file-code" size={17} /> Changes
              </button>
            </div>
            {activeTab === "evidence" ? (
              <EvidenceView
                expandedId={expandedId}
                items={filteredEvidence}
                onNotify={showToast}
                {...(controller.refreshIncident
                  ? { onRefresh: controller.refreshIncident }
                  : {})}
                onToggle={(id) =>
                  setExpandedId((current) => (current === id ? null : id))
                }
                total={incident.evidence.length}
              />
            ) : null}
            {activeTab === "graph" ? (
              incident.graph ? (
                <CoreGraphView
                  graph={incident.graph}
                  onOpenEvidence={openEvidence}
                />
              ) : (
                <GraphView
                  initialSelectedNode={initialGraphNodeId}
                  onOpenEvidence={openEvidence}
                />
              )
            ) : null}
            {activeTab === "changes" ? (
              incident.workflow ? (
                <CoreChangesView
                  controller={controller}
                  incidentId={incident.id}
                  onNotify={showToast}
                  workflow={incident.workflow}
                />
              ) : (
                <ChangesView
                  controller={controller}
                  incidentId={incident.id}
                  onNotify={showToast}
                  remediation={incident.remediation}
                />
              )
            ) : null}
          </section>
          {diagnosisOpen ? (
            <DiagnosisPanel
              compact={compactDiagnosis}
              {...(incident.diagnosis ? { diagnosis: incident.diagnosis } : {})}
              onClose={closeDiagnosis}
              onNotify={showToast}
              onOpenEvidence={openEvidence}
              onTabChange={setActiveTab}
            />
          ) : (
            <DiagnosisLauncher
              compact={compactDiagnosis}
              {...(incident.diagnosis ? { diagnosis: incident.diagnosis } : {})}
              onOpen={openDiagnosis}
            />
          )}
        </div>
      </section>
      {toast ? (
        <div className="toast" data-motion-state={toastState} role="status">
          <Icon name="check-circle" size={18} /> {toast}
        </div>
      ) : null}
    </main>
  )
}
