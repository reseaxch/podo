"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useToast } from "../hooks/use-toast"
import type { IncidentTab, IncidentWorkspaceData } from "../lib/incident-types"
import { ChangesView } from "./incident/changes-view"
import { DiagnosisLauncher, DiagnosisPanel } from "./incident/diagnosis-panel"
import { EvidenceView } from "./incident/evidence-view"
import { GraphView } from "./incident/graph-view"
import { IncidentHeader } from "./incident/incident-header"
import { IconRail } from "./shell/icon-rail"
import { Topbar } from "./shell/topbar"
import { Icon } from "./ui/pictogram"

export function IncidentWorkspace({
  incident,
}: {
  incident: IncidentWorkspaceData
}) {
  const [activeTab, setActiveTab] = useState<IncidentTab>("evidence")
  const [expandedId, setExpandedId] = useState<string | null>("trace")
  const [diagnosisOpen, setDiagnosisOpen] = useState(true)
  const [compactDiagnosis, setCompactDiagnosis] = useState(false)
  const [query, setQuery] = useState("")
  const compactLayoutRef = useRef<boolean | null>(null)
  const shellRef = useRef<HTMLElement | null>(null)
  const { toast, showToast } = useToast()

  const filteredEvidence = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return incident.evidence
    return incident.evidence.filter((item) =>
      `${item.source} ${item.provider} ${item.finding} ${item.detail}`
        .toLowerCase()
        .includes(normalized),
    )
  }, [incident.evidence, query])

  const openEvidence = useCallback((id: string) => {
    setActiveTab("evidence")
    setExpandedId(id)
  }, [])
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
      <IconRail onNotify={showToast} onTabChange={setActiveTab} />
      <Topbar
        incident={incident}
        onNotify={showToast}
        onOpenEvidence={openEvidence}
        onQueryChange={setQuery}
        onTabChange={setActiveTab}
        query={query}
      />
      <section className="workspace" id="workspace">
        <IncidentHeader incident={incident} onNotify={showToast} />
        <div
          className={`workspace-body ${diagnosisOpen ? "" : "diagnosis-collapsed"}`}
        >
          <section className="investigation-panel">
            <div className="tabs" role="tablist" aria-label="Incident views">
              <button
                aria-selected={activeTab === "evidence"}
                onClick={() => setActiveTab("evidence")}
                role="tab"
                type="button"
              >
                <Icon name="list-bullets" size={17} /> Evidence
              </button>
              <button
                aria-selected={activeTab === "graph"}
                onClick={() => setActiveTab("graph")}
                role="tab"
                type="button"
              >
                <Icon name="graph" size={17} /> Graph
              </button>
              <button
                aria-selected={activeTab === "changes"}
                onClick={() => setActiveTab("changes")}
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
                onToggle={(id) =>
                  setExpandedId((current) => (current === id ? null : id))
                }
                total={incident.evidence.length}
              />
            ) : null}
            {activeTab === "graph" ? (
              <GraphView onOpenEvidence={openEvidence} />
            ) : null}
            {activeTab === "changes" ? (
              <ChangesView onNotify={showToast} />
            ) : null}
          </section>
          {diagnosisOpen ? (
            <DiagnosisPanel
              compact={compactDiagnosis}
              onClose={closeDiagnosis}
              onNotify={showToast}
              onOpenEvidence={openEvidence}
              onTabChange={setActiveTab}
            />
          ) : (
            <DiagnosisLauncher
              compact={compactDiagnosis}
              onOpen={openDiagnosis}
            />
          )}
        </div>
      </section>
      {toast ? (
        <div className="toast" role="status">
          <Icon name="check-circle" size={18} /> {toast}
        </div>
      ) : null}
    </main>
  )
}
