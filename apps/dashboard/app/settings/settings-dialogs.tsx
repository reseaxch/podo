"use client"

import { useEffect, useId, useState } from "react"

import { Icon } from "../components/ui/pictogram"
import { SelectMenu } from "../components/ui/select-menu"
import type { WorkspaceRole, WorkspaceSettings } from "./settings-model"
import styles from "./settings.module.css"

type Connection = WorkspaceSettings["connections"][number]

const inviteRoles = ["Engineer", "Responder", "Viewer"].map((value) => ({
  value: value as Exclude<WorkspaceRole, "Owner">,
  label: value,
}))

export const connectionCatalog: Connection[] = [
  {
    id: "pagerduty",
    name: "PagerDuty",
    detail: "On-call schedules and escalation policy",
    kind: "delivery",
    connected: false,
    lastSync: "Not connected",
  },
  {
    id: "grafana-cloud",
    name: "Grafana Cloud",
    detail: "Metrics, logs, and distributed traces",
    kind: "observability",
    connected: false,
    lastSync: "Not connected",
  },
  {
    id: "gitlab",
    name: "GitLab",
    detail: "Repositories, merge requests, and pipelines",
    kind: "repository",
    connected: false,
    lastSync: "Not connected",
  },
]

function DialogShell({
  title,
  description,
  icon,
  onClose,
  children,
}: {
  title: string
  description: string
  icon: "shield-check" | "share-network" | "database"
  onClose: () => void
  children: React.ReactNode
}) {
  const titleId = useId()

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [onClose])

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <header className={styles.dialogHeader}>
          <span>
            <Icon name={icon} size={18} />
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose} type="button">
            <Icon name="x" size={15} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

export function PlanDialog({
  plan,
  onClose,
}: {
  plan: string
  onClose: () => void
}) {
  return (
    <DialogShell
      description="Review workspace capacity, billing status, and included controls."
      icon="shield-check"
      onClose={onClose}
      title="Plan management"
    >
      <div className={styles.planOverview}>
        <div>
          <span>Current subscription</span>
          <strong>{plan}</strong>
          <small>Renews Aug 14, 2026 · billed monthly</small>
        </div>
        <em>Active</em>
      </div>
      <div className={styles.usageGrid} aria-label="Current plan usage">
        <article>
          <span>Seats</span>
          <strong>8 / 10</strong>
          <i style={{ "--usage": "80%" } as React.CSSProperties} />
        </article>
        <article>
          <span>Evidence ingest</span>
          <strong>1.8 / 3 TB</strong>
          <i style={{ "--usage": "60%" } as React.CSSProperties} />
        </article>
        <article>
          <span>Audit retention</span>
          <strong>365 days</strong>
          <small>Included in Team</small>
        </article>
      </div>
      <div className={styles.planFeatures}>
        <strong>Included workspace controls</strong>
        <span>
          <Icon name="check-circle" size={14} /> Approval boundaries
        </span>
        <span>
          <Icon name="check-circle" size={14} /> Unlimited incident viewers
        </span>
        <span>
          <Icon name="check-circle" size={14} /> SSO and domain restrictions
        </span>
      </div>
      <footer className={styles.dialogFooter}>
        <span>Next invoice · $480 on Aug 14</span>
        <button onClick={onClose} type="button">
          Done
        </button>
      </footer>
    </DialogShell>
  )
}

export function InviteMemberDialog({
  existingEmails,
  onClose,
  onInvite,
}: {
  existingEmails: string[]
  onClose: () => void
  onInvite: (input: {
    email: string
    role: Exclude<WorkspaceRole, "Owner">
  }) => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Exclude<WorkspaceRole, "Owner">>("Engineer")
  const [error, setError] = useState("")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Enter a valid work email.")
      return
    }
    if (existingEmails.some((item) => item.toLowerCase() === normalized)) {
      setError("This person is already in the workspace.")
      return
    }
    onInvite({ email: normalized, role })
  }

  return (
    <DialogShell
      description="Invite a teammate with the minimum access they need."
      icon="share-network"
      onClose={onClose}
      title="Invite workspace member"
    >
      <form className={styles.dialogForm} onSubmit={submit}>
        <label>
          <span>Work email</span>
          <input
            aria-invalid={Boolean(error)}
            autoFocus
            onChange={(event) => {
              setEmail(event.target.value)
              setError("")
            }}
            placeholder="name@company.com"
            type="email"
            value={email}
          />
          {error ? <small className={styles.dialogError}>{error}</small> : null}
        </label>
        <label>
          <span>Workspace role</span>
          <SelectMenu
            ariaLabel="Invitation role"
            onValueChange={setRole}
            options={inviteRoles}
            value={role}
          />
          <small>
            {role === "Engineer"
              ? "Can investigate and prepare patches."
              : role === "Responder"
                ? "Can investigate and approve sandbox runs."
                : "Read-only access to incidents and evidence."}
          </small>
        </label>
        <div className={styles.inviteBoundary}>
          <Icon name="shield-check" size={16} />
          <span>
            Production changes still require an explicit human approval.
          </span>
        </div>
        <footer className={styles.dialogFooter}>
          <button onClick={onClose} type="button">
            Cancel
          </button>
          <button className={styles.primaryDialogAction} type="submit">
            Send invitation
          </button>
        </footer>
      </form>
    </DialogShell>
  )
}

export function ConnectionCatalogDialog({
  connectedIds,
  onAdd,
  onClose,
}: {
  connectedIds: string[]
  onAdd: (connection: Connection) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLowerCase()
  const visible = connectionCatalog.filter((item) =>
    `${item.name} ${item.detail}`.toLowerCase().includes(normalized),
  )

  return (
    <DialogShell
      description="Add another source to the evidence correlation pipeline."
      icon="database"
      onClose={onClose}
      title="Integration catalog"
    >
      <label className={styles.catalogSearch}>
        <Icon name="magnifying-glass" size={15} />
        <input
          aria-label="Search integrations"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search integrations..."
          type="search"
          value={query}
        />
      </label>
      <div className={styles.catalogList}>
        {visible.map((connection) => {
          const added = connectedIds.includes(connection.id)
          return (
            <article key={connection.id}>
              <span>
                <Icon
                  name={
                    connection.kind === "repository"
                      ? "git-branch"
                      : connection.kind === "delivery"
                        ? "rocket-launch"
                        : "activity"
                  }
                  size={17}
                />
              </span>
              <div>
                <strong>{connection.name}</strong>
                <small>{connection.detail}</small>
              </div>
              <button
                aria-label={`${added ? "Added" : "Add"} ${connection.name}`}
                disabled={added}
                onClick={() => onAdd(connection)}
                type="button"
              >
                {added ? "Added" : "Add"}
              </button>
            </article>
          )
        })}
        {!visible.length ? (
          <p className={styles.catalogEmpty}>
            No integrations match “{query}”.
          </p>
        ) : null}
      </div>
      <footer className={styles.dialogFooter}>
        <span>
          Connections are activated only after workspace settings save.
        </span>
        <button onClick={onClose} type="button">
          Done
        </button>
      </footer>
    </DialogShell>
  )
}
