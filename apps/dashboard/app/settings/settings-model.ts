export type WorkspaceRole = "Owner" | "Engineer" | "Responder" | "Viewer"
export type ApprovalBoundary = "automatic" | "approval-required" | "blocked"
export type WorkspaceTimezone =
  "America/Los_Angeles" | "Europe/Copenhagen" | "UTC"

export type WorkspaceSettings = {
  workspace: {
    name: string
    slug: string
    incidentPrefix: string
    timezone: WorkspaceTimezone
  }
  incidentDefaults: {
    defaultSeverity: "P1" | "P2" | "P3"
    evidenceWindowMinutes: 15 | 30 | 60
    escalationMinutes: 5 | 10 | 15 | 30
    autoAssignOwner: boolean
    createIncidentChannel: boolean
  }
  connections: Array<{
    id: string
    name: string
    detail: string
    kind: "repository" | "observability" | "delivery"
    connected: boolean
    lastSync: string
  }>
  members: Array<{
    id: string
    name: string
    email: string
    initials: string
    role: WorkspaceRole
    status: "Active" | "Invited"
  }>
  autonomy: {
    investigate: ApprovalBoundary
    runTests: ApprovalBoundary
    createPullRequest: ApprovalBoundary
    productionMutation: "blocked"
  }
  notifications: {
    criticalIncidents: boolean
    approvalRequests: boolean
    investigationUpdates: boolean
    weeklyDigest: boolean
    email: string
    slackChannel: string
  }
  retention: {
    evidenceDays: 30 | 60 | 90 | 180
    auditDays: 90 | 180 | 365
    redactSecrets: boolean
  }
  security: {
    requireMfa: boolean
    sessionHours: 8 | 12 | 24 | 72
    ssoProvider: "Disabled" | "Okta" | "Google Workspace"
    restrictDomains: boolean
    allowedDomain: string
  }
}

export type WorkspaceSettingsViewModel = {
  revision: number
  permissions: { canManageSettings: boolean }
  owner: { name: string; avatar: string }
  plan: string
  settings: WorkspaceSettings
}

export type SettingsFieldErrors = Partial<
  Record<
    | "workspace.name"
    | "workspace.slug"
    | "workspace.incidentPrefix"
    | "notifications.email"
    | "security.allowedDomain",
    string
  >
>

export type SaveSettingsResult =
  | { ok: true; revision: number; settings: WorkspaceSettings }
  | {
      ok: false
      code: "validation"
      message: string
      fields: SettingsFieldErrors
    }
  | { ok: false; code: "stale" | "forbidden" | "unavailable"; message: string }

export type WorkspaceSettingsController = {
  save(input: {
    expectedRevision: number
    settings: WorkspaceSettings
  }): Promise<SaveSettingsResult>
}

const initialSettings: WorkspaceSettings = {
  workspace: {
    name: "Podo Cloud",
    slug: "podo-cloud",
    incidentPrefix: "INC",
    timezone: "America/Los_Angeles",
  },
  incidentDefaults: {
    defaultSeverity: "P2",
    evidenceWindowMinutes: 30,
    escalationMinutes: 10,
    autoAssignOwner: true,
    createIncidentChannel: true,
  },
  connections: [
    {
      id: "github",
      name: "GitHub",
      detail: "reseaxch/podo · main",
      kind: "repository",
      connected: true,
      lastSync: "Synced 2m ago",
    },
    {
      id: "datadog",
      name: "Datadog",
      detail: "Production · US1",
      kind: "observability",
      connected: true,
      lastSync: "Streaming now",
    },
    {
      id: "github-actions",
      name: "GitHub Actions",
      detail: "12 workflows indexed",
      kind: "delivery",
      connected: true,
      lastSync: "Synced 4m ago",
    },
    {
      id: "sentry",
      name: "Sentry",
      detail: "Performance and errors",
      kind: "observability",
      connected: false,
      lastSync: "Not connected",
    },
  ],
  members: [
    {
      id: "maya",
      name: "Maya Chen",
      email: "maya@podo.dev",
      initials: "MC",
      role: "Owner",
      status: "Active",
    },
    {
      id: "alex",
      name: "Alex Rivera",
      email: "alex@podo.dev",
      initials: "AR",
      role: "Engineer",
      status: "Active",
    },
    {
      id: "nora",
      name: "Nora Shah",
      email: "nora@podo.dev",
      initials: "NS",
      role: "Responder",
      status: "Active",
    },
    {
      id: "liam",
      name: "Liam Brooks",
      email: "liam@podo.dev",
      initials: "LB",
      role: "Viewer",
      status: "Invited",
    },
  ],
  autonomy: {
    investigate: "automatic",
    runTests: "automatic",
    createPullRequest: "approval-required",
    productionMutation: "blocked",
  },
  notifications: {
    criticalIncidents: true,
    approvalRequests: true,
    investigationUpdates: false,
    weeklyDigest: true,
    email: "oncall@podo.dev",
    slackChannel: "#incidents-podo",
  },
  retention: { evidenceDays: 90, auditDays: 365, redactSecrets: true },
  security: {
    requireMfa: true,
    sessionHours: 12,
    ssoProvider: "Google Workspace",
    restrictDomains: true,
    allowedDomain: "podo.dev",
  },
}

const clone = (settings: WorkspaceSettings): WorkspaceSettings =>
  structuredClone(settings)

function validate(settings: WorkspaceSettings): SettingsFieldErrors {
  const fields: SettingsFieldErrors = {}
  if (settings.workspace.name.trim().length < 2)
    fields["workspace.name"] =
      "Workspace name must contain at least 2 characters."
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(settings.workspace.slug))
    fields["workspace.slug"] =
      "Use lowercase letters, numbers, and single hyphens."
  if (!/^[A-Z]{2,6}$/.test(settings.workspace.incidentPrefix))
    fields["workspace.incidentPrefix"] = "Use 2–6 uppercase letters."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.notifications.email))
    fields["notifications.email"] = "Enter a valid notification email."
  if (
    settings.security.restrictDomains &&
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(settings.security.allowedDomain)
  )
    fields["security.allowedDomain"] = "Enter a valid workspace domain."
  return fields
}

export function createMockSettingsController(
  source: WorkspaceSettingsViewModel,
): WorkspaceSettingsController {
  let currentRevision = source.revision
  let current = clone(source.settings)
  return {
    async save(input) {
      if (!source.permissions.canManageSettings)
        return {
          ok: false,
          code: "forbidden",
          message: "Only workspace owners can change these settings.",
        }
      if (input.expectedRevision !== currentRevision)
        return {
          ok: false,
          code: "stale",
          message: "Settings changed in another session. Reload before saving.",
        }
      if (input.settings.autonomy.productionMutation !== "blocked")
        return {
          ok: false,
          code: "forbidden",
          message: "Production mutations must remain blocked.",
        }
      const fields = validate(input.settings)
      if (Object.keys(fields).length)
        return {
          ok: false,
          code: "validation",
          message: "Review the highlighted settings.",
          fields,
        }
      current = clone(input.settings)
      currentRevision += 1
      return { ok: true, revision: currentRevision, settings: clone(current) }
    },
  }
}

export function getWorkspaceSettings(): WorkspaceSettingsViewModel {
  return {
    revision: 12,
    permissions: { canManageSettings: true },
    owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
    plan: "Team · 8 seats",
    settings: clone(initialSettings),
  }
}
