import { createDashboardClient, isDemoDashboard } from "../lib/dashboard-client"

export type GraphLayer = "runtime" | "delivery" | "code"
export type GraphHealth = "healthy" | "degraded" | "critical" | "changed"
export type GraphNodeKind =
  | "service"
  | "database"
  | "queue"
  | "external"
  | "deployment"
  | "commit"
  | "file"

export type SystemTraceSample = {
  id: string
  name: string
  startedAt: string
  duration: string
  spans: number
  status: "error" | "slow" | "healthy"
}

export type SystemGraphNode = {
  id: string
  label: string
  subtitle: string
  kind: GraphNodeKind
  layer: GraphLayer
  health: GraphHealth
  x: number
  y: number
  metrics: Array<{ label: string; value: string; trend?: string }>
  owner: string
  environment: string
  updated: string
  description: string
  evidence: Array<{
    label: string
    value: string
    tone: "neutral" | "warning" | "critical"
  }>
  incidentId?: string
  incidentNodeId?: "deploy" | "heap" | "trace" | "gc" | "code"
  causalContext?: Array<{
    label: string
    value: string
  }>
  traces?: SystemTraceSample[]
}

export type GraphEdge = {
  id: string
  from: string
  to: string
  relation:
    "traffic" | "publishes" | "reads" | "deployed-by" | "contains" | "causal"
  label: string
  health: "normal" | "warning" | "critical"
}

export type SystemGraphViewModel = {
  owner: { name: string; avatar: string }
  capturedAt: string
  environment: string
  stats: {
    services: number
    unhealthy: number
    changes: number
    traces: string
  }
  windows: Array<{
    label: string
    traces: string
    capturedAt: string
  }>
  nodes: SystemGraphNode[]
  edges: GraphEdge[]
}

const nodes: SystemGraphNode[] = [
  {
    id: "edge-gateway",
    label: "edge-gateway",
    subtitle: "Public API · us-west-2",
    kind: "service",
    layer: "runtime",
    health: "healthy",
    x: 70,
    y: 285,
    metrics: [
      { label: "Throughput", value: "428 rps" },
      { label: "p95", value: "91 ms" },
    ],
    owner: "Platform",
    environment: "production",
    updated: "12s ago",
    description: "Routes public checkout traffic and propagates trace context.",
    evidence: [
      { label: "Error rate", value: "0.08%", tone: "neutral" },
      { label: "SLO", value: "99.98%", tone: "neutral" },
    ],
  },
  {
    id: "checkout-service",
    label: "checkout-service",
    subtitle: "Node.js · 12 pods",
    kind: "service",
    layer: "runtime",
    health: "critical",
    x: 340,
    y: 285,
    metrics: [
      { label: "Error rate", value: "8.7%", trend: "+7.9" },
      { label: "p95", value: "1.82 s", trend: "+1.4s" },
    ],
    owner: "Checkout",
    environment: "production",
    updated: "8s ago",
    description:
      "Coordinates cart validation, inventory reservation, and payment authorization.",
    incidentId: "INC-042",
    incidentNodeId: "code",
    evidence: [
      { label: "Incident", value: "INC-042", tone: "critical" },
      { label: "Heap", value: "91%", tone: "critical" },
      { label: "Trace samples", value: "312", tone: "warning" },
    ],
    causalContext: [
      { label: "Deploy v1.8.4", value: "42m ago" },
      { label: "Heap began climbing", value: "+9m" },
      { label: "Checkout errors", value: "8.7%" },
    ],
    traces: [
      {
        id: "tr-91af2d",
        name: "POST /checkout",
        startedAt: "10:24:08.412",
        duration: "1.82 s",
        spans: 17,
        status: "error",
      },
      {
        id: "tr-44c8b1",
        name: "CheckoutCache.set",
        startedAt: "10:23:51.908",
        duration: "1.34 s",
        spans: 12,
        status: "slow",
      },
      {
        id: "tr-10e7ca",
        name: "POST /cart/validate",
        startedAt: "10:22:39.173",
        duration: "684 ms",
        spans: 9,
        status: "slow",
      },
    ],
  },
  {
    id: "inventory-service",
    label: "inventory-service",
    subtitle: "Go · 8 pods",
    kind: "service",
    layer: "runtime",
    health: "healthy",
    x: 665,
    y: 92,
    metrics: [
      { label: "Throughput", value: "182 rps" },
      { label: "p95", value: "74 ms" },
    ],
    owner: "Supply",
    environment: "production",
    updated: "11s ago",
    description: "Validates availability and reserves inventory for checkout.",
    evidence: [
      { label: "Error rate", value: "0.12%", tone: "neutral" },
      { label: "Saturation", value: "42%", tone: "neutral" },
    ],
  },
  {
    id: "payments-service",
    label: "payments-service",
    subtitle: "Kotlin · 10 pods",
    kind: "service",
    layer: "runtime",
    health: "degraded",
    x: 665,
    y: 285,
    metrics: [
      { label: "Error rate", value: "2.4%", trend: "+1.8" },
      { label: "p95", value: "684 ms", trend: "+220" },
    ],
    owner: "Payments",
    environment: "production",
    updated: "9s ago",
    description: "Authorizes payments and records transaction outcomes.",
    evidence: [
      { label: "Upstream timeouts", value: "46", tone: "warning" },
      { label: "Retry rate", value: "4.1%", tone: "warning" },
    ],
  },
  {
    id: "notification-worker",
    label: "notification-worker",
    subtitle: "Node.js · 4 pods",
    kind: "service",
    layer: "runtime",
    health: "healthy",
    x: 665,
    y: 478,
    metrics: [
      { label: "Jobs", value: "61/min" },
      { label: "Lag", value: "1.2 s" },
    ],
    owner: "Lifecycle",
    environment: "production",
    updated: "17s ago",
    description: "Consumes order events and sends transactional notifications.",
    evidence: [
      { label: "Dead letters", value: "0", tone: "neutral" },
      { label: "Success", value: "99.9%", tone: "neutral" },
    ],
  },
  {
    id: "inventory-db",
    label: "inventory-primary",
    subtitle: "PostgreSQL · writer",
    kind: "database",
    layer: "runtime",
    health: "healthy",
    x: 1010,
    y: 92,
    metrics: [
      { label: "Queries", value: "2.1k/s" },
      { label: "p95", value: "18 ms" },
    ],
    owner: "Data platform",
    environment: "production",
    updated: "14s ago",
    description: "Primary inventory state store with synchronous replication.",
    evidence: [
      { label: "Connections", value: "62 / 200", tone: "neutral" },
      { label: "Replica lag", value: "24 ms", tone: "neutral" },
    ],
  },
  {
    id: "stripe-api",
    label: "Stripe API",
    subtitle: "External dependency",
    kind: "external",
    layer: "runtime",
    health: "healthy",
    x: 1010,
    y: 285,
    metrics: [
      { label: "Calls", value: "93 rps" },
      { label: "p95", value: "412 ms" },
    ],
    owner: "External",
    environment: "global",
    updated: "21s ago",
    description: "Payment authorization and capture provider.",
    evidence: [
      { label: "Availability", value: "99.99%", tone: "neutral" },
      { label: "Provider status", value: "Operational", tone: "neutral" },
    ],
  },
  {
    id: "orders-topic",
    label: "orders.created",
    subtitle: "Kafka · 12 partitions",
    kind: "queue",
    layer: "runtime",
    health: "healthy",
    x: 1010,
    y: 478,
    metrics: [
      { label: "Events", value: "61/min" },
      { label: "Lag", value: "8" },
    ],
    owner: "Platform",
    environment: "production",
    updated: "15s ago",
    description: "Durable order event stream consumed by lifecycle workers.",
    evidence: [
      { label: "Under-replicated", value: "0", tone: "neutral" },
      { label: "Oldest event", value: "1.2 s", tone: "neutral" },
    ],
  },
  {
    id: "deploy-184",
    label: "checkout v1.8.4",
    subtitle: "Deployment · 42m ago",
    kind: "deployment",
    layer: "delivery",
    health: "changed",
    x: 340,
    y: 665,
    metrics: [
      { label: "Pods", value: "12 / 12" },
      { label: "Rollout", value: "3m 14s" },
    ],
    owner: "Maya Chen",
    environment: "production",
    updated: "42m ago",
    description:
      "Current checkout production deployment; anomaly began nine minutes after rollout.",
    incidentId: "INC-042",
    incidentNodeId: "deploy",
    evidence: [
      { label: "Change correlation", value: "94%", tone: "critical" },
      { label: "Rollback", value: "Available", tone: "neutral" },
    ],
    causalContext: [
      { label: "Deploy completed", value: "10:02 AM" },
      { label: "Heap crossed threshold", value: "+4m" },
      { label: "Incident INC-042", value: "+11m" },
    ],
  },
  {
    id: "commit-8f3a2c1",
    label: "8f3a2c1",
    subtitle: "Commit · checkout cache",
    kind: "commit",
    layer: "delivery",
    health: "changed",
    x: 665,
    y: 665,
    metrics: [
      { label: "Files", value: "3 changed" },
      { label: "Author", value: "mchen" },
    ],
    owner: "Maya Chen",
    environment: "main",
    updated: "1h ago",
    description: "Removes the cache size cap while simplifying session reuse.",
    incidentId: "INC-042",
    incidentNodeId: "deploy",
    evidence: [
      { label: "Risky hunk", value: "cache.ts:47", tone: "critical" },
      { label: "Tests", value: "+2 / −1", tone: "warning" },
    ],
    causalContext: [
      { label: "Commit 8f3a2c1", value: "1h ago" },
      { label: "Deployed as v1.8.4", value: "+18m" },
      { label: "Correlated to incident", value: "94%" },
    ],
  },
  {
    id: "cache-file",
    label: "session-cache.ts",
    subtitle: "src/cache · TypeScript",
    kind: "file",
    layer: "code",
    health: "critical",
    x: 1010,
    y: 665,
    metrics: [
      { label: "Confidence", value: "96%" },
      { label: "Line", value: "47" },
    ],
    owner: "Checkout",
    environment: "repository",
    updated: "1h ago",
    description:
      "Unbounded Map retains checkout sessions after requests complete.",
    incidentId: "INC-042",
    incidentNodeId: "code",
    evidence: [
      { label: "Heap retainers", value: "63.8 MB", tone: "critical" },
      { label: "Regression", value: "Reproduced", tone: "critical" },
    ],
    causalContext: [
      { label: "session-cache.ts:47", value: "changed" },
      { label: "Unbounded retention", value: "confirmed" },
      { label: "Checkout errors", value: "8.7%" },
    ],
  },
]

const edges: GraphEdge[] = [
  {
    id: "e1",
    from: "edge-gateway",
    to: "checkout-service",
    relation: "traffic",
    label: "428 rps",
    health: "warning",
  },
  {
    id: "e2",
    from: "checkout-service",
    to: "inventory-service",
    relation: "traffic",
    label: "182 rps",
    health: "normal",
  },
  {
    id: "e3",
    from: "checkout-service",
    to: "payments-service",
    relation: "traffic",
    label: "93 rps · 2.4%",
    health: "critical",
  },
  {
    id: "e4",
    from: "checkout-service",
    to: "notification-worker",
    relation: "publishes",
    label: "61/min",
    health: "normal",
  },
  {
    id: "e5",
    from: "inventory-service",
    to: "inventory-db",
    relation: "reads",
    label: "2.1k qps",
    health: "normal",
  },
  {
    id: "e6",
    from: "payments-service",
    to: "stripe-api",
    relation: "traffic",
    label: "93 rps",
    health: "warning",
  },
  {
    id: "e7",
    from: "notification-worker",
    to: "orders-topic",
    relation: "reads",
    label: "lag 8",
    health: "normal",
  },
  {
    id: "e8",
    from: "deploy-184",
    to: "checkout-service",
    relation: "deployed-by",
    label: "runs",
    health: "critical",
  },
  {
    id: "e9",
    from: "commit-8f3a2c1",
    to: "deploy-184",
    relation: "contains",
    label: "contains",
    health: "critical",
  },
  {
    id: "e10",
    from: "cache-file",
    to: "commit-8f3a2c1",
    relation: "causal",
    label: "changed in",
    health: "critical",
  },
]

export function adaptSystemGraph(): SystemGraphViewModel {
  return {
    owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
    capturedAt: "Live · updated 8s ago",
    environment: "production / us-west-2",
    stats: { services: 8, unhealthy: 2, changes: 1, traces: "18.4k" },
    windows: [
      {
        label: "Last 30m",
        traces: "18.4k",
        capturedAt: "Live · updated 8s ago",
      },
      {
        label: "Last 2h",
        traces: "71.2k",
        capturedAt: "Live · updated 18s ago",
      },
      {
        label: "Last 24h",
        traces: "842k",
        capturedAt: "Live · updated 31s ago",
      },
    ],
    nodes,
    edges,
  }
}

export async function getSystemGraph(): Promise<SystemGraphViewModel> {
  if (isDemoDashboard()) return adaptSystemGraph()
  const client = createDashboardClient()
  const { incidents } = await client.listIncidents()
  const liveNodes: SystemGraphNode[] = []
  const liveEdges: GraphEdge[] = []

  for (const [index, incident] of incidents.entries()) {
    const serviceId = `service-${incident.id}`
    const deploymentId = `deployment-${incident.id}`
    const y = 110 + index * 210
    liveNodes.push(
      {
        id: serviceId,
        label: incident.affectedService,
        subtitle: `Detected incident · ${incident.id}`,
        kind: "service",
        layer: "runtime",
        health: "critical",
        x: 650,
        y,
        metrics: [
          { label: "Evidence", value: String(incident.evidence.length) },
        ],
        owner: "Podo Core",
        environment: "production",
        updated: incident.updatedAt,
        description: `Affected service for ${incident.id}.`,
        evidence: [{ label: "Incident", value: incident.id, tone: "critical" }],
        incidentId: incident.id,
        incidentNodeId: "code",
      },
      {
        id: deploymentId,
        label: incident.deploymentId,
        subtitle: "Authoritative deployment",
        kind: "deployment",
        layer: "delivery",
        health: "changed",
        x: 390,
        y,
        metrics: [{ label: "Incident", value: incident.id }],
        owner: "Podo Core",
        environment: "production",
        updated: incident.updatedAt,
        description: "Deployment linked to the detected incident.",
        evidence: [
          {
            label: "Service",
            value: incident.affectedService,
            tone: "warning",
          },
        ],
        incidentId: incident.id,
        incidentNodeId: "deploy",
      },
    )
    liveEdges.push({
      id: `deployment-service-${incident.id}`,
      from: deploymentId,
      to: serviceId,
      relation: "deployed-by",
      label: "runs",
      health: "critical",
    })

    const evidence = incident.evidence[0]
    if (!evidence) continue
    try {
      const { causalPath } = await client.getIncidentCausalPath(
        incident.id,
        evidence.id,
      )
      const commitId = `commit-${incident.id}`
      const fileId = `file-${incident.id}`
      liveNodes.push(
        {
          id: commitId,
          label: causalPath.commit.sha,
          subtitle: "Causal commit",
          kind: "commit",
          layer: "code",
          health: "changed",
          x: 210,
          y,
          metrics: [{ label: "Evidence", value: evidence.id }],
          owner: "Podo Core",
          environment: "repository",
          updated: causalPath.telemetryEvent.occurredAt,
          description: "Commit resolved through the Core causal path.",
          evidence: [
            {
              label: "Deployment",
              value: incident.deploymentId,
              tone: "warning",
            },
          ],
          incidentId: incident.id,
          incidentNodeId: "code",
        },
        {
          id: fileId,
          label: causalPath.file.label,
          subtitle: causalPath.function.label,
          kind: "file",
          layer: "code",
          health: "critical",
          x: 30,
          y,
          metrics: [{ label: "Function", value: causalPath.function.label }],
          owner: "Podo Core",
          environment: "repository",
          updated: causalPath.telemetryEvent.occurredAt,
          description:
            "Code location cited by the evidence-backed causal path.",
          evidence: [
            { label: "Evidence", value: evidence.id, tone: "critical" },
          ],
          incidentId: incident.id,
          incidentNodeId: "code",
        },
      )
      liveEdges.push(
        {
          id: `commit-deployment-${incident.id}`,
          from: commitId,
          to: deploymentId,
          relation: "contains",
          label: "deployed as",
          health: "critical",
        },
        {
          id: `file-commit-${incident.id}`,
          from: fileId,
          to: commitId,
          relation: "causal",
          label: "changed in",
          health: "critical",
        },
      )
    } catch {
      // The graph remains useful with the incident/deployment boundary when a
      // causal path is not yet available. No code node is invented.
    }
  }

  return {
    owner: { name: "Podo Core", avatar: "/icon.svg" },
    capturedAt: "Live · Core API",
    environment: "Core incident graph",
    stats: {
      services: incidents.length,
      unhealthy: incidents.length,
      changes: liveNodes.filter((node) => node.kind === "commit").length,
      traces: String(
        incidents
          .flatMap((incident) => incident.evidence)
          .filter((item) => item.sourceType === "trace").length,
      ),
    },
    windows: [
      {
        label: "Current Core state",
        traces: `${liveNodes.length} nodes`,
        capturedAt: "No synthetic history",
      },
    ],
    nodes: liveNodes,
    edges: liveEdges,
  }
}
