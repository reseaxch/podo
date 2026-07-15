"use client"

import { useMemo, useState } from "react"

import { IconRail } from "../components/shell/icon-rail"
import { Topbar } from "../components/shell/topbar"
import { Icon } from "../components/ui/pictogram"
import { SelectMenu } from "../components/ui/select-menu"
import { useToast } from "../hooks/use-toast"
import type { IconName } from "../lib/incident-types"
import {
  createMockSettingsController,
  type ApprovalBoundary,
  type SettingsFieldErrors,
  type WorkspaceRole,
  type WorkspaceSettings,
  type WorkspaceSettingsController,
  type WorkspaceSettingsViewModel,
} from "./settings-model"
import {
  ConnectionCatalogDialog,
  InviteMemberDialog,
  PlanDialog,
} from "./settings-dialogs"
import styles from "./settings.module.css"

type SectionId =
  | "workspace"
  | "incidents"
  | "connections"
  | "team"
  | "autonomy"
  | "notifications"
  | "security"
  | "retention"

const sections: Array<{
  id: SectionId
  label: string
  hint: string
  icon: IconName
}> = [
  {
    id: "workspace",
    label: "Workspace",
    hint: "Identity and defaults",
    icon: "cube",
  },
  {
    id: "incidents",
    label: "Incident defaults",
    hint: "Triage and escalation",
    icon: "activity",
  },
  {
    id: "connections",
    label: "Repositories & data",
    hint: "Sources and sync",
    icon: "database",
  },
  {
    id: "team",
    label: "Team & roles",
    hint: "Access boundaries",
    icon: "share-network",
  },
  {
    id: "autonomy",
    label: "AI autonomy",
    hint: "Approval policy",
    icon: "shield-check",
  },
  {
    id: "notifications",
    label: "Notifications",
    hint: "Routing and digests",
    icon: "bell",
  },
  {
    id: "security",
    label: "Security & access",
    hint: "Identity and sessions",
    icon: "shield-check",
  },
  {
    id: "retention",
    label: "Data retention",
    hint: "Evidence lifecycle",
    icon: "clock",
  },
]

const timezoneOptions = [
  { value: "America/Los_Angeles", label: "America / Los Angeles" },
  { value: "Europe/Copenhagen", label: "Europe / Copenhagen" },
  { value: "UTC", label: "UTC" },
] as const
const severityOptions = [
  { value: "P1", label: "P1 · Critical", description: "Immediate response" },
  { value: "P2", label: "P2 · High priority", description: "Default triage" },
  { value: "P3", label: "P3 · Standard", description: "Normal queue" },
] as const
const evidenceWindowOptions = [15, 30, 60].map((value) => ({
  value: String(value) as "15" | "30" | "60",
  label: `${value} minutes`,
}))
const escalationOptions = [5, 10, 15, 30].map((value) => ({
  value: String(value) as "5" | "10" | "15" | "30",
  label: `${value} minutes`,
}))
const roleOptions = ["Owner", "Engineer", "Responder", "Viewer"].map(
  (value) => ({ value: value as WorkspaceRole, label: value }),
)
const ssoOptions = ["Disabled", "Okta", "Google Workspace"].map((value) => ({
  value: value as "Disabled" | "Okta" | "Google Workspace",
  label: value,
}))
const sessionOptions = [8, 12, 24, 72].map((value) => ({
  value: String(value) as "8" | "12" | "24" | "72",
  label: `${value} hours`,
}))
const evidenceRetentionOptions = [30, 60, 90, 180].map((value) => ({
  value: String(value) as "30" | "60" | "90" | "180",
  label: `${value} days`,
}))
const auditRetentionOptions = [90, 180, 365].map((value) => ({
  value: String(value) as "90" | "180" | "365",
  label: `${value} days`,
}))

const clone = (settings: WorkspaceSettings) => structuredClone(settings)

export function SettingsWorkspace({
  view,
  controller: providedController,
}: {
  view: WorkspaceSettingsViewModel
  controller?: WorkspaceSettingsController
}) {
  const controller = useMemo(
    () => providedController ?? createMockSettingsController(view),
    [providedController, view],
  )
  const [activeSection, setActiveSection] = useState<SectionId>("workspace")
  const [saved, setSaved] = useState(() => clone(view.settings))
  const [draft, setDraft] = useState(() => clone(view.settings))
  const [revision, setRevision] = useState(view.revision)
  const [fieldErrors, setFieldErrors] = useState<SettingsFieldErrors>({})
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error"
    message: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [dialog, setDialog] = useState<
    "plan" | "connections" | "invite" | null
  >(null)
  const { toast, showToast } = useToast()
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  function update(mutator: (current: WorkspaceSettings) => void) {
    setDraft((current) => {
      const next = clone(current)
      mutator(next)
      return next
    })
    setFeedback(null)
  }

  function cancel() {
    setDraft(clone(saved))
    setFieldErrors({})
    setFeedback(null)
  }

  async function save() {
    setSaving(true)
    setFieldErrors({})
    try {
      const result = await controller.save({
        expectedRevision: revision,
        settings: clone(draft),
      })
      if (!result.ok) {
        if (result.code === "validation") setFieldErrors(result.fields)
        setFeedback({ tone: "error", message: result.message })
        return
      }
      setRevision(result.revision)
      setSaved(clone(result.settings))
      setDraft(clone(result.settings))
      setFeedback({ tone: "success", message: "Workspace settings saved." })
    } catch {
      setFeedback({
        tone: "error",
        message: "Settings service is unavailable. No changes were applied.",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="app-shell" data-ready="true">
      <IconRail />
      <Topbar
        current="Settings"
        onNotify={showToast}
        onQueryChange={setQuery}
        owner={view.owner}
        query={query}
        searchLabel="Search settings"
        searchPlaceholder="Search settings..."
      />

      <section className={styles.page}>
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Workspace administration</span>
            <h1>Settings</h1>
            <p>
              Configure how Podo observes, investigates, and acts across your
              workspace.
            </p>
          </div>
          <div className={styles.plan}>
            <span>
              <Icon name="shield-check" size={16} />
            </span>
            <div>
              <small>Current plan</small>
              <strong>{view.plan}</strong>
            </div>
            <button onClick={() => setDialog("plan")} type="button">
              Manage
            </button>
          </div>
        </header>

        <section
          className={styles.workspacePulse}
          aria-label="Workspace status"
        >
          <div>
            <span className={styles.pulseIcon}>
              <Icon name="database" size={16} />
            </span>
            <span>
              <small>Evidence coverage</small>
              <strong>
                {draft.connections.filter((item) => item.connected).length}/
                {draft.connections.length} sources
              </strong>
            </span>
            <em className={styles.healthy}>Healthy</em>
          </div>
          <div>
            <span className={styles.pulseIcon}>
              <Icon name="share-network" size={16} />
            </span>
            <span>
              <small>Workspace access</small>
              <strong>
                {
                  draft.members.filter((item) => item.status === "Active")
                    .length
                }
                /{draft.members.length} members active
              </strong>
            </span>
          </div>
          <div>
            <span className={styles.pulseIcon}>
              <Icon name="shield-check" size={16} />
            </span>
            <span>
              <small>Production actions</small>
              <strong>Human approval enforced</strong>
            </span>
            <em className={styles.lockedState}>Locked</em>
          </div>
          <div>
            <span className={styles.pulseIcon}>
              <Icon name="clock" size={16} />
            </span>
            <span>
              <small>Audit retention</small>
              <strong>{draft.retention.auditDays} days</strong>
            </span>
          </div>
        </section>

        <div className={styles.layout}>
          <nav className={styles.sectionNav} aria-label="Settings sections">
            <span className={styles.navLabel}>Configuration</span>
            {sections.map((section) => (
              <button
                aria-current={activeSection === section.id ? "page" : undefined}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <span>
                  <Icon name={section.icon} size={16} />
                </span>
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.hint}</small>
                </span>
                <Icon name="caret-right" size={13} />
              </button>
            ))}
            <div className={styles.safetyNote}>
              <Icon name="shield-check" size={17} />
              <div>
                <strong>Safe by default</strong>
                <small>
                  Production mutations remain blocked across every policy.
                </small>
              </div>
            </div>
          </nav>

          <div className={styles.content}>
            {feedback ? (
              <div
                className={`${styles.feedback} ${styles[feedback.tone]}`}
                role="status"
              >
                <Icon
                  name={
                    feedback.tone === "success"
                      ? "check-circle"
                      : "warning-circle"
                  }
                  size={17}
                />
                <span>{feedback.message}</span>
                <button
                  aria-label="Dismiss message"
                  onClick={() => setFeedback(null)}
                  type="button"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ) : null}

            {activeSection === "workspace" ? (
              <SettingsSection
                title="Workspace profile"
                description="Shared identity used in incidents, reports, and connected tools."
                icon="cube"
              >
                <div className={styles.formGrid}>
                  <Field
                    label="Workspace name"
                    error={fieldErrors["workspace.name"]}
                  >
                    <input
                      aria-invalid={Boolean(fieldErrors["workspace.name"])}
                      onChange={(event) =>
                        update((current) => {
                          current.workspace.name = event.target.value
                        })
                      }
                      value={draft.workspace.name}
                    />
                  </Field>
                  <Field
                    label="Workspace slug"
                    error={fieldErrors["workspace.slug"]}
                    hint="Used in workspace URLs and API identifiers."
                  >
                    <div className={styles.prefixInput}>
                      <span>podo.dev/</span>
                      <input
                        aria-invalid={Boolean(fieldErrors["workspace.slug"])}
                        autoCapitalize="none"
                        autoCorrect="off"
                        onChange={(event) =>
                          update((current) => {
                            current.workspace.slug = event.target.value
                          })
                        }
                        spellCheck={false}
                        value={draft.workspace.slug}
                      />
                    </div>
                  </Field>
                  <Field
                    label="Incident prefix"
                    error={fieldErrors["workspace.incidentPrefix"]}
                    hint="2–6 uppercase letters."
                  >
                    <input
                      aria-invalid={Boolean(
                        fieldErrors["workspace.incidentPrefix"],
                      )}
                      maxLength={6}
                      onChange={(event) =>
                        update((current) => {
                          current.workspace.incidentPrefix =
                            event.target.value.toUpperCase()
                        })
                      }
                      value={draft.workspace.incidentPrefix}
                    />
                  </Field>
                  <Field label="Default timezone">
                    <SelectMenu
                      ariaLabel="Default timezone"
                      onValueChange={(value) =>
                        update((current) => {
                          current.workspace.timezone = value
                        })
                      }
                      options={timezoneOptions}
                      value={draft.workspace.timezone}
                    />
                  </Field>
                </div>
                <div className={styles.preview}>
                  <span>{draft.workspace.incidentPrefix || "INC"}-043</span>
                  <div>
                    <strong>Incident identifiers</strong>
                    <small>
                      New incidents will use this prefix. Existing identifiers
                      do not change.
                    </small>
                  </div>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === "incidents" ? (
              <SettingsSection
                title="Incident defaults"
                description="Set consistent triage behavior before an investigation begins."
                icon="activity"
              >
                <div className={styles.formGrid}>
                  <Field
                    label="Default severity"
                    hint="Applied until evidence establishes a different priority."
                  >
                    <SelectMenu
                      ariaLabel="Default severity"
                      onValueChange={(value) =>
                        update((current) => {
                          current.incidentDefaults.defaultSeverity = value
                        })
                      }
                      options={severityOptions}
                      value={draft.incidentDefaults.defaultSeverity}
                    />
                  </Field>
                  <Field
                    label="Evidence window"
                    hint="Context collected before and after the first anomaly."
                  >
                    <SelectMenu
                      ariaLabel="Evidence window"
                      onValueChange={(value) =>
                        update((current) => {
                          current.incidentDefaults.evidenceWindowMinutes =
                            Number(value) as 15 | 30 | 60
                        })
                      }
                      options={evidenceWindowOptions}
                      value={
                        String(draft.incidentDefaults.evidenceWindowMinutes) as
                          "15" | "30" | "60"
                      }
                    />
                  </Field>
                  <Field
                    label="Escalation timer"
                    hint="Alert responders when ownership is still missing."
                  >
                    <SelectMenu
                      ariaLabel="Escalation timer"
                      onValueChange={(value) =>
                        update((current) => {
                          current.incidentDefaults.escalationMinutes = Number(
                            value,
                          ) as 5 | 10 | 15 | 30
                        })
                      }
                      options={escalationOptions}
                      value={
                        String(draft.incidentDefaults.escalationMinutes) as
                          "5" | "10" | "15" | "30"
                      }
                    />
                  </Field>
                  <Field label="Triage timezone">
                    <input readOnly value={draft.workspace.timezone} />
                  </Field>
                </div>
                <div className={styles.toggleListCompact}>
                  <Toggle
                    label="Auto-assign service owner"
                    detail="Use catalog ownership when a single accountable team is known."
                    checked={draft.incidentDefaults.autoAssignOwner}
                    onChange={(checked) =>
                      update((current) => {
                        current.incidentDefaults.autoAssignOwner = checked
                      })
                    }
                  />
                  <Toggle
                    label="Create incident channel"
                    detail="Open a dedicated collaboration channel for P1 and P2 incidents."
                    checked={draft.incidentDefaults.createIncidentChannel}
                    onChange={(checked) =>
                      update((current) => {
                        current.incidentDefaults.createIncidentChannel = checked
                      })
                    }
                  />
                </div>
                <div className={styles.preview}>
                  <span>{draft.incidentDefaults.defaultSeverity}</span>
                  <div>
                    <strong>Default triage policy</strong>
                    <small>
                      Collect {draft.incidentDefaults.evidenceWindowMinutes}m of
                      evidence and escalate unowned incidents after{" "}
                      {draft.incidentDefaults.escalationMinutes}m.
                    </small>
                  </div>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === "connections" ? (
              <SettingsSection
                title="Repositories & integrations"
                description="Control the sources Podo can observe and correlate."
                icon="database"
                action={
                  <button
                    className={styles.secondaryAction}
                    onClick={() => setDialog("connections")}
                    type="button"
                  >
                    Add connection
                  </button>
                }
              >
                <div className={styles.connectionList}>
                  {draft.connections.map((connection) => (
                    <article key={connection.id}>
                      <span
                        className={`${styles.connectionIcon} ${styles[connection.kind]}`}
                      >
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
                      <span
                        className={
                          connection.connected
                            ? styles.connected
                            : styles.disconnected
                        }
                      >
                        <i />{" "}
                        {connection.connected
                          ? connection.lastSync
                          : "Disconnected"}
                      </span>
                      <button
                        aria-label={`${connection.connected ? "Disconnect" : "Connect"} ${connection.name}`}
                        onClick={() =>
                          update((current) => {
                            const item = current.connections.find(
                              (entry) => entry.id === connection.id,
                            )
                            if (item) item.connected = !item.connected
                          })
                        }
                        type="button"
                      >
                        {connection.connected ? "Disconnect" : "Connect"}
                      </button>
                    </article>
                  ))}
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === "team" ? (
              <SettingsSection
                title="Team & roles"
                description="Grant only the access each person needs to respond safely."
                icon="share-network"
                action={
                  <button
                    className={styles.secondaryAction}
                    onClick={() => setDialog("invite")}
                    type="button"
                  >
                    Invite member
                  </button>
                }
              >
                <div className={styles.teamHeader}>
                  <span>Member</span>
                  <span>Workspace role</span>
                  <span>Status</span>
                </div>
                <div className={styles.teamList}>
                  {draft.members.map((member) => (
                    <div key={member.id}>
                      <i>{member.initials}</i>
                      <span>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </span>
                      <SelectMenu
                        ariaLabel={`Role for ${member.name}`}
                        className={styles.roleSelect}
                        disabled={member.id === "maya"}
                        onValueChange={(value) =>
                          update((current) => {
                            const item = current.members.find(
                              (entry) => entry.id === member.id,
                            )
                            if (item) item.role = value
                          })
                        }
                        options={roleOptions}
                        value={member.role}
                      />
                      <span className={styles.memberStatus}>
                        <i /> {member.status}
                      </span>
                    </div>
                  ))}
                </div>
                <div className={styles.roleLegend}>
                  <strong>Role boundaries</strong>
                  <span>
                    <b>Engineer</b> Investigate and prepare patches
                  </span>
                  <span>
                    <b>Responder</b> Investigate and approve runs
                  </span>
                  <span>
                    <b>Viewer</b> Read-only access
                  </span>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === "autonomy" ? (
              <SettingsSection
                title="AI autonomy & approvals"
                description="Choose where Podo can proceed and where a human must decide."
                icon="shield-check"
              >
                <div className={styles.boundaryBanner}>
                  <Icon name="shield-check" size={18} />
                  <div>
                    <strong>Approval boundary is enforced by core</strong>
                    <small>
                      UI settings cannot bypass production safety rules or
                      approval audit events.
                    </small>
                  </div>
                </div>
                <div className={styles.policyList}>
                  <PolicyRow
                    label="Investigate evidence"
                    detail="Read logs, traces, metrics, and code context."
                    value={draft.autonomy.investigate}
                    onChange={(value) =>
                      update((current) => {
                        current.autonomy.investigate = value
                      })
                    }
                  />
                  <PolicyRow
                    label="Run tests in sandbox"
                    detail="Execute regression tests in an isolated checkout."
                    value={draft.autonomy.runTests}
                    onChange={(value) =>
                      update((current) => {
                        current.autonomy.runTests = value
                      })
                    }
                  />
                  <PolicyRow
                    label="Create pull request"
                    detail="Publish a verified patch to a review branch."
                    value={draft.autonomy.createPullRequest}
                    onChange={(value) =>
                      update((current) => {
                        current.autonomy.createPullRequest = value
                      })
                    }
                  />
                  <div className={`${styles.policyRow} ${styles.locked}`}>
                    <div>
                      <span>
                        <Icon name="shield-check" size={15} /> Production
                        mutation
                      </span>
                      <small>
                        Deploy, rollback, scale, or modify live infrastructure.
                      </small>
                    </div>
                    <span className={styles.blockedPill}>
                      <Icon name="shield-check" size={13} /> Always blocked
                    </span>
                  </div>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === "notifications" ? (
              <SettingsSection
                title="Notifications"
                description="Route urgent decisions without overwhelming the team."
                icon="bell"
              >
                <div className={styles.toggleList}>
                  <Toggle
                    label="Critical incidents"
                    detail="P1/P2 incidents and material impact changes."
                    checked={draft.notifications.criticalIncidents}
                    onChange={(checked) =>
                      update((current) => {
                        current.notifications.criticalIncidents = checked
                      })
                    }
                  />
                  <Toggle
                    label="Approval requests"
                    detail="Agent actions waiting for a human decision."
                    checked={draft.notifications.approvalRequests}
                    onChange={(checked) =>
                      update((current) => {
                        current.notifications.approvalRequests = checked
                      })
                    }
                  />
                  <Toggle
                    label="Investigation updates"
                    detail="Diagnosis and evidence changes during active incidents."
                    checked={draft.notifications.investigationUpdates}
                    onChange={(checked) =>
                      update((current) => {
                        current.notifications.investigationUpdates = checked
                      })
                    }
                  />
                  <Toggle
                    label="Weekly operations digest"
                    detail="Reliability trends, response time, and automation outcomes."
                    checked={draft.notifications.weeklyDigest}
                    onChange={(checked) =>
                      update((current) => {
                        current.notifications.weeklyDigest = checked
                      })
                    }
                  />
                </div>
                <div className={styles.formGrid}>
                  <Field
                    label="Notification email"
                    error={fieldErrors["notifications.email"]}
                  >
                    <input
                      aria-invalid={Boolean(fieldErrors["notifications.email"])}
                      onChange={(event) =>
                        update((current) => {
                          current.notifications.email = event.target.value
                        })
                      }
                      type="email"
                      value={draft.notifications.email}
                    />
                  </Field>
                  <Field label="Slack channel">
                    <input
                      onChange={(event) =>
                        update((current) => {
                          current.notifications.slackChannel =
                            event.target.value
                        })
                      }
                      value={draft.notifications.slackChannel}
                    />
                  </Field>
                </div>
              </SettingsSection>
            ) : null}

            {activeSection === "security" ? (
              <SettingsSection
                title="Security & access"
                description="Control identity, sessions, and workspace entry points."
                icon="shield-check"
              >
                <div className={styles.boundaryBanner}>
                  <Icon name="shield-check" size={18} />
                  <div>
                    <strong>Owner-managed security boundary</strong>
                    <small>
                      Authentication policy is enforced server-side and every
                      change is written to the audit log.
                    </small>
                  </div>
                </div>
                <div className={styles.formGridSecurity}>
                  <Field label="Single sign-on provider">
                    <SelectMenu
                      ariaLabel="Single sign-on provider"
                      onValueChange={(value) =>
                        update((current) => {
                          current.security.ssoProvider = value
                        })
                      }
                      options={ssoOptions}
                      value={draft.security.ssoProvider}
                    />
                  </Field>
                  <Field
                    label="Session lifetime"
                    hint="Users must authenticate again when the session expires."
                  >
                    <SelectMenu
                      ariaLabel="Session lifetime"
                      onValueChange={(value) =>
                        update((current) => {
                          current.security.sessionHours = Number(value) as
                            8 | 12 | 24 | 72
                        })
                      }
                      options={sessionOptions}
                      value={
                        String(draft.security.sessionHours) as
                          "8" | "12" | "24" | "72"
                      }
                    />
                  </Field>
                </div>
                <div className={styles.toggleListCompact}>
                  <Toggle
                    label="Require multi-factor authentication"
                    detail="Block access for members without a verified second factor."
                    checked={draft.security.requireMfa}
                    onChange={(checked) =>
                      update((current) => {
                        current.security.requireMfa = checked
                      })
                    }
                  />
                  <Toggle
                    label="Restrict sign-in domains"
                    detail="Only verified company domains may join this workspace."
                    checked={draft.security.restrictDomains}
                    onChange={(checked) =>
                      update((current) => {
                        current.security.restrictDomains = checked
                      })
                    }
                  />
                </div>
                {draft.security.restrictDomains ? (
                  <div className={styles.domainField}>
                    <Field
                      label="Allowed domain"
                      error={fieldErrors["security.allowedDomain"]}
                      hint="Invitations outside this domain will be rejected."
                    >
                      <div className={styles.prefixInput}>
                        <span>@</span>
                        <input
                          aria-invalid={Boolean(
                            fieldErrors["security.allowedDomain"],
                          )}
                          autoCapitalize="none"
                          autoCorrect="off"
                          onChange={(event) =>
                            update((current) => {
                              current.security.allowedDomain =
                                event.target.value
                            })
                          }
                          spellCheck={false}
                          value={draft.security.allowedDomain}
                        />
                      </div>
                    </Field>
                  </div>
                ) : null}
              </SettingsSection>
            ) : null}

            {activeSection === "retention" ? (
              <SettingsSection
                title="Data retention"
                description="Keep enough context for investigation while limiting exposure."
                icon="clock"
              >
                <div className={styles.retentionGrid}>
                  <Field
                    label="Evidence retention"
                    hint="Logs, traces, metrics, diffs, and test artifacts."
                  >
                    <SelectMenu
                      ariaLabel="Evidence retention"
                      onValueChange={(value) =>
                        update((current) => {
                          current.retention.evidenceDays = Number(value) as
                            30 | 60 | 90 | 180
                        })
                      }
                      options={evidenceRetentionOptions}
                      value={
                        String(draft.retention.evidenceDays) as
                          "30" | "60" | "90" | "180"
                      }
                    />
                  </Field>
                  <Field
                    label="Audit log retention"
                    hint="Agent actions, approvals, and policy decisions."
                  >
                    <SelectMenu
                      ariaLabel="Audit log retention"
                      onValueChange={(value) =>
                        update((current) => {
                          current.retention.auditDays = Number(value) as
                            90 | 180 | 365
                        })
                      }
                      options={auditRetentionOptions}
                      value={
                        String(draft.retention.auditDays) as
                          "90" | "180" | "365"
                      }
                    />
                  </Field>
                </div>
                <Toggle
                  label="Redact detected secrets"
                  detail="Mask credentials, tokens, and high-confidence secrets before evidence is persisted."
                  checked={draft.retention.redactSecrets}
                  onChange={(checked) =>
                    update((current) => {
                      current.retention.redactSecrets = checked
                    })
                  }
                />
                <div className={styles.retentionNote}>
                  <Icon name="database" size={17} />
                  <div>
                    <strong>Estimated retained evidence: 4.8 GB</strong>
                    <small>
                      Based on the current 90-day window and the last 30 days of
                      ingestion.
                    </small>
                  </div>
                </div>
              </SettingsSection>
            ) : null}

            <footer
              className={`${styles.saveBar} ${dirty ? styles.visible : ""}`}
            >
              <span>
                <i />{" "}
                {dirty
                  ? "Unsaved changes"
                  : `All changes saved · revision ${revision}`}
              </span>
              <div>
                <button
                  disabled={!dirty || saving}
                  onClick={cancel}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={!dirty || saving}
                  onClick={save}
                  type="button"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {toast ? (
        <div className={styles.toast} role="status">
          <Icon name="check-circle" size={17} /> {toast}
        </div>
      ) : null}
      {dialog === "plan" ? (
        <PlanDialog onClose={() => setDialog(null)} plan={view.plan} />
      ) : null}
      {dialog === "connections" ? (
        <ConnectionCatalogDialog
          connectedIds={draft.connections.map((item) => item.id)}
          onAdd={(connection) => {
            update((current) => {
              if (
                !current.connections.some((item) => item.id === connection.id)
              )
                current.connections.push(connection)
            })
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "invite" ? (
        <InviteMemberDialog
          existingEmails={draft.members.map((member) => member.email)}
          onClose={() => setDialog(null)}
          onInvite={({ email, role }) => {
            const local = email.split("@")[0] ?? "Member"
            const name = local
              .split(/[._-]/)
              .filter(Boolean)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" ")
            update((current) => {
              current.members.push({
                id: `invite-${Date.now()}`,
                name: name || "Invited member",
                email,
                initials: (name || email).slice(0, 2).toUpperCase(),
                role,
                status: "Invited",
              })
            })
            setDialog(null)
            showToast("Invitation added to pending changes")
          }}
        />
      ) : null}
    </main>
  )
}

function SettingsSection({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string
  description: string
  icon: IconName
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={styles.section}>
      <header>
        <span>
          <Icon name={icon} size={18} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {action}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string | undefined
  error?: string | undefined
  children: React.ReactNode
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {error ? (
        <small className={styles.fieldError}>{error}</small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  )
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={styles.toggleRow}>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <i aria-hidden="true" />
    </label>
  )
}

function PolicyRow({
  label,
  detail,
  value,
  onChange,
}: {
  label: string
  detail: string
  value: ApprovalBoundary
  onChange: (value: ApprovalBoundary) => void
}) {
  return (
    <div className={styles.policyRow}>
      <div>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <div
        className={styles.policyOptions}
        role="group"
        aria-label={`${label} policy`}
      >
        {(["automatic", "approval-required", "blocked"] as const).map(
          (option) => (
            <button
              aria-pressed={value === option}
              key={option}
              onClick={() => onChange(option)}
              type="button"
            >
              {option === "automatic"
                ? "Automatic"
                : option === "approval-required"
                  ? "Ask first"
                  : "Blocked"}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
