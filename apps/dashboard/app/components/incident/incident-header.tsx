"use client"

import Image from "next/image"
import { useState } from "react"

import { useMenu } from "../../hooks/use-menu"
import type {
  IncidentController,
  IncidentWorkspaceViewModel,
} from "../../lib/incident-types"
import { Icon } from "../ui/pictogram"

export function IncidentHeader({
  controller,
  incident,
  onNotify,
}: {
  controller: IncidentController
  incident: IncidentWorkspaceViewModel
  onNotify: (message: string) => void
}) {
  const [incidentStatus, setIncidentStatus] = useState(incident.status)
  const [statusPending, setStatusPending] = useState(false)
  const [updatesMuted, setUpdatesMuted] = useState(false)
  const { closeMenu, menuRef, openMenu, toggleMenu } = useMenu<
    "status" | "actions"
  >()
  const displayedStatus =
    incident.statusEditable === false ? incident.status : incidentStatus

  function exportIncidentSummary() {
    const diagnosis = incident.diagnosis
    const summary = [
      `${incident.id} · ${incident.title}`,
      `Status: ${displayedStatus}`,
      ...(diagnosis?.probableRootCause
        ? [`Root cause: ${diagnosis.probableRootCause}`]
        : []),
      ...(diagnosis?.confidencePercent === undefined
        ? []
        : [`Confidence: ${diagnosis.confidencePercent}%`]),
      ...(diagnosis?.summary ? [`Diagnosis: ${diagnosis.summary}`] : []),
    ].join("\n")
    const url = URL.createObjectURL(new Blob([summary], { type: "text/plain" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${incident.id}-summary.txt`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    closeMenu()
    onNotify("Incident summary exported")
  }

  return (
    <header className="incident-header">
      <div>
        <h1>{incident.title}</h1>
        <div className="incident-meta">
          <span className="severity">{incident.severity}</span>
          {incident.statusEditable === false ? (
            <span
              className={`status-button status-${displayedStatus.toLowerCase()}`}
            >
              <span /> {displayedStatus}
            </span>
          ) : (
            <div
              className="menu-anchor status-anchor"
              ref={openMenu === "status" ? menuRef : undefined}
            >
              <button
                aria-expanded={openMenu === "status"}
                aria-haspopup="menu"
                className={`status-button status-${incidentStatus.toLowerCase()}`}
                onClick={(event) => toggleMenu("status", event.currentTarget)}
                type="button"
              >
                <span /> {incidentStatus} <Icon name="caret-down" size={13} />
              </button>
              {openMenu === "status" ? (
                <div className="shell-menu status-menu" role="menu">
                  <span className="menu-label">Incident status</span>
                  {(
                    [
                      "Investigating",
                      "Mitigating",
                      "Monitoring",
                      "Resolved",
                    ] as const
                  ).map((status) => (
                    <button
                      aria-current={
                        incidentStatus === status ? "true" : undefined
                      }
                      key={status}
                      disabled={statusPending}
                      onClick={async () => {
                        if (status === incidentStatus) {
                          closeMenu()
                          return
                        }
                        setStatusPending(true)
                        try {
                          const next = await controller.updateStatus({
                            incidentId: incident.id,
                            expectedStatus: incidentStatus,
                            status,
                          })
                          setIncidentStatus(next.status)
                          closeMenu()
                          onNotify(`Status changed to ${next.status}`)
                        } catch (error) {
                          onNotify(
                            error instanceof Error
                              ? error.message
                              : "Incident status was not changed",
                          )
                        } finally {
                          setStatusPending(false)
                        }
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <i
                        className={`status-dot status-${status.toLowerCase()}`}
                      />
                      <span>{status}</span>
                      {incidentStatus === status ? (
                        <Icon name="check-circle" size={15} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <span>
            <Icon name="cube" size={16} /> {incident.service}
          </span>
          <span>
            <Icon name="clock" size={16} /> {incident.elapsed}
          </span>
          <span className="owner">
            <small>Owner</small>
            <Image
              alt=""
              height={24}
              src={incident.owner.avatar}
              width={24}
            />{" "}
            {incident.owner.name}
          </span>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="secondary-button"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href)
            onNotify("Incident link copied")
          }}
          type="button"
        >
          <Icon name="share-network" size={17} /> Share
        </button>
        <div
          className="menu-anchor actions-anchor"
          ref={openMenu === "actions" ? menuRef : undefined}
        >
          <button
            aria-expanded={openMenu === "actions"}
            aria-haspopup="menu"
            aria-label="More incident actions"
            className="icon-button"
            onClick={(event) => toggleMenu("actions", event.currentTarget)}
            type="button"
          >
            <Icon name="dots-three" />
          </button>
          {openMenu === "actions" ? (
            <div className="shell-menu actions-menu" role="menu">
              <span className="menu-label">Incident actions</span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(incident.id)
                  closeMenu()
                  onNotify("Incident ID copied")
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="copy" size={16} />
                <span>
                  <strong>Copy incident ID</strong>
                  <small>{incident.id}</small>
                </span>
              </button>
              <button
                onClick={() => {
                  setUpdatesMuted((muted) => !muted)
                  closeMenu()
                  onNotify(
                    updatesMuted
                      ? "Incident updates unmuted"
                      : "Incident updates muted",
                  )
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="bell" size={16} />
                <span>
                  <strong>
                    {updatesMuted ? "Unmute updates" : "Mute updates"}
                  </strong>
                  <small>
                    {updatesMuted
                      ? "Resume notifications"
                      : "Silence this incident"}
                  </small>
                </span>
              </button>
              <button
                onClick={exportIncidentSummary}
                role="menuitem"
                type="button"
              >
                <Icon name="file-text" size={16} />
                <span>
                  <strong>Export summary</strong>
                  <small>Download .txt report</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
