import { createHash } from "node:crypto"
import {
  PODO_CODE_GRAPH_SCHEMA_VERSION,
  type CodeGraphLinkType,
  type CodeGraphNodeKind,
  type NormalizedCodeGraphLink,
  type NormalizedCodeGraphNode,
  type NormalizedCodeGraphSnapshot,
} from "@podo/contracts"

export type OperationalGraphNode =
  | { id: string; kind: "commit"; sha: string }
  | { id: string; kind: "deployment" }
  | { id: string; kind: "container" }
  | { id: string; kind: "telemetry_event"; occurredAt: string }
  | { id: string; kind: "incident" }
  | { id: string; kind: "evidence" }

export type OperationalGraphLinkType =
  | "SUPPORTED_BY"
  | "DERIVED_FROM"
  | "OBSERVED_IN"
  | "RUNS"
  | "USES"
  | "CHANGED"

export interface OperationalGraphLink {
  type: OperationalGraphLinkType
  fromNodeId: string
  toNodeId: string
}

export interface OperationalGraphOverlay {
  nodes: OperationalGraphNode[]
  links: OperationalGraphLink[]
}

export interface PodoCausalPath {
  id: string
  incidentNodeId: string
  evidenceNodeId: string
  telemetryEventNodeId: string
  containerNodeId: string
  deploymentNodeId: string
  commitNodeId: string
  fileNodeId: string
  functionNodeId: string
  nodeIds: string[]
}

export type PodoGraphIssueCode =
  | "unsupported_schema_version"
  | "duplicate_node_id"
  | "duplicate_link_id"
  | "duplicate_link"
  | "invalid_node"
  | "invalid_link"
  | "dangling_link"
  | "missing_required_link"
  | "ambiguous_required_link"

export interface PodoGraphIssue {
  code: PodoGraphIssueCode
  path: string
  message: string
}

export type PodoGraphLoadResult =
  | {
      ok: true
      graph: { id: string; nodeCount: number; linkCount: number }
    }
  | {
      ok: false
      rejection: {
        code: "PODO_GRAPH_REJECTED"
        issues: PodoGraphIssue[]
      }
    }

export type PodoCausalPathResult =
  | { ok: true; path: PodoCausalPath }
  | {
      ok: false
      rejection: {
        code: "PODO_CAUSAL_PATH_UNRESOLVED"
        issues: PodoGraphIssue[]
      }
    }

type AnyNodeKind = CodeGraphNodeKind | OperationalGraphNode["kind"]

interface StoredLink {
  id: string
  type: CodeGraphLinkType | OperationalGraphLinkType
  fromNodeId: string
  toNodeId: string
}

interface GraphState {
  id: string
  codeNodes: Map<string, NormalizedCodeGraphNode>
  operationalNodes: Map<string, OperationalGraphNode>
  nodeKinds: Map<string, AnyNodeKind>
  links: StoredLink[]
  paths: Map<string, PodoCausalPath>
}

interface CandidateState extends Omit<GraphState, "id" | "paths"> {
  id?: string
  paths?: Map<string, PodoCausalPath>
}

const CODE_NODE_KINDS = new Set<string>([
  "repository",
  "service",
  "file",
  "function",
  "endpoint",
])
const CODE_LINK_TYPES = new Set<string>(["CONTAINS", "OWNS", "IMPORTS", "CALLS", "EXPOSES"])
const OPERATIONAL_NODE_KINDS = new Set<string>([
  "commit",
  "deployment",
  "container",
  "telemetry_event",
  "incident",
  "evidence",
])
const OPERATIONAL_LINK_TYPES = new Set<string>([
  "SUPPORTED_BY",
  "DERIVED_FROM",
  "OBSERVED_IN",
  "RUNS",
  "USES",
  "CHANGED",
])

const OPERATIONAL_LINK_KINDS: Record<OperationalGraphLinkType, readonly [AnyNodeKind, AnyNodeKind]> = {
  SUPPORTED_BY: ["incident", "evidence"],
  DERIVED_FROM: ["evidence", "telemetry_event"],
  OBSERVED_IN: ["telemetry_event", "container"],
  RUNS: ["container", "deployment"],
  USES: ["deployment", "commit"],
  CHANGED: ["commit", "file"],
}

export class InMemoryPodoGraph {
  private state: GraphState | null = null

  load(input: {
    codeGraph: NormalizedCodeGraphSnapshot
    operationalOverlay: OperationalGraphOverlay
  }): PodoGraphLoadResult {
    const issues: PodoGraphIssue[] = []
    const candidate = buildCandidate(input.codeGraph, input.operationalOverlay, issues)

    if (issues.length === 0) {
      validateCausalPaths(candidate, issues)
    }

    if (issues.length > 0) {
      return {
        ok: false,
        rejection: {
          code: "PODO_GRAPH_REJECTED",
          issues: sortIssues(issues),
        },
      }
    }

    const paths = candidate.paths ?? new Map<string, PodoCausalPath>()
    const graphContent = {
      codeGraph: canonicalCodeGraph(input.codeGraph),
      operationalOverlay: canonicalOperationalOverlay(input.operationalOverlay),
    }
    const state: GraphState = {
      id: stableId("podo_graph", graphContent),
      codeNodes: candidate.codeNodes,
      operationalNodes: candidate.operationalNodes,
      nodeKinds: candidate.nodeKinds,
      links: candidate.links,
      paths,
    }
    this.state = state

    return {
      ok: true,
      graph: {
        id: state.id,
        nodeCount: state.nodeKinds.size,
        linkCount: state.links.length,
      },
    }
  }

  resolveCausalPath(input: {
    incidentId: string
    evidenceId: string
  }): PodoCausalPathResult {
    if (!this.state) {
      return unresolved([
        {
          code: "missing_required_link",
          path: "graph",
          message: "No graph has been loaded",
        },
      ])
    }

    const path = this.state.paths.get(pathKey(input.incidentId, input.evidenceId))
    if (!path) {
      return unresolved([
        {
          code: "missing_required_link",
          path: `causalPath[incident=${input.incidentId},evidence=${input.evidenceId}]`,
          message: "The evidence is not linked to the incident by a resolvable causal path",
        },
      ])
    }
    return { ok: true, path: structuredClone(path) }
  }

  getCodeNode(id: string): NormalizedCodeGraphNode | null {
    const node = this.state?.codeNodes.get(id)
    return node ? structuredClone(node) : null
  }
}

function buildCandidate(
  codeGraph: NormalizedCodeGraphSnapshot,
  overlay: OperationalGraphOverlay,
  issues: PodoGraphIssue[],
): CandidateState {
  const codeNodes = new Map<string, NormalizedCodeGraphNode>()
  const operationalNodes = new Map<string, OperationalGraphNode>()
  const nodeKinds = new Map<string, AnyNodeKind>()
  const links: StoredLink[] = []

  if (codeGraph.schemaVersion !== PODO_CODE_GRAPH_SCHEMA_VERSION) {
    addIssue(
      issues,
      "unsupported_schema_version",
      "codeGraph.schemaVersion",
      `Unsupported code graph schema "${String(codeGraph.schemaVersion)}"`,
    )
  }

  const codeNodeCounts = countIds(codeGraph.nodes)
  for (const [id, count] of codeNodeCounts) {
    if (count > 1) {
      addIssue(
        issues,
        "duplicate_node_id",
        `codeGraph.nodes[id=${id}]`,
        `Node ID "${id}" appears more than once`,
      )
    }
  }
  for (const node of codeGraph.nodes) {
    if (!isNonEmpty(node.id) || !CODE_NODE_KINDS.has(node.kind)) {
      addIssue(
        issues,
        "invalid_node",
        `codeGraph.nodes[id=${String(node.id)}]`,
        "Code node must have a non-empty ID and supported kind",
      )
      continue
    }
    if (!codeNodes.has(node.id)) {
      const cloned = structuredClone(node)
      codeNodes.set(node.id, cloned)
      nodeKinds.set(node.id, node.kind)
    }
  }

  const operationalNodeCounts = countIds(overlay.nodes)
  for (const [id, count] of operationalNodeCounts) {
    if (count > 1 || codeNodes.has(id)) {
      addIssue(
        issues,
        "duplicate_node_id",
        `operationalOverlay.nodes[id=${id}]`,
        `Node ID "${id}" is not unique across the graph`,
      )
    }
  }
  for (const node of overlay.nodes) {
    if (!isNonEmpty(node.id) || !OPERATIONAL_NODE_KINDS.has(node.kind)) {
      addIssue(
        issues,
        "invalid_node",
        `operationalOverlay.nodes[id=${String(node.id)}]`,
        "Operational node must have a non-empty ID and supported kind",
      )
      continue
    }
    if (!nodeKinds.has(node.id)) {
      const cloned = structuredClone(node)
      operationalNodes.set(node.id, cloned)
      nodeKinds.set(node.id, node.kind)
    }
  }

  const codeLinkCounts = countIds(codeGraph.links)
  for (const [id, count] of codeLinkCounts) {
    if (count > 1) {
      addIssue(
        issues,
        "duplicate_link_id",
        `codeGraph.links[id=${id}]`,
        `Link ID "${id}" appears more than once`,
      )
    }
  }
  for (const link of codeGraph.links) {
    const path = `codeGraph.links[id=${link.id}]`
    if (!isNonEmpty(link.id) || !CODE_LINK_TYPES.has(link.type)) {
      addIssue(issues, "invalid_link", path, "Code link must have a non-empty ID and supported type")
      continue
    }
    validateEndpoints(link, path, nodeKinds, issues)
    if (!links.some((stored) => stored.id === link.id)) {
      links.push({
        id: link.id,
        type: link.type,
        fromNodeId: link.fromNodeId,
        toNodeId: link.toNodeId,
      })
    }
  }

  const operationalLinkKeys = new Map<string, number>()
  for (const link of overlay.links) {
    const key = operationalLinkKey(link)
    operationalLinkKeys.set(key, (operationalLinkKeys.get(key) ?? 0) + 1)
  }
  for (const [key, count] of operationalLinkKeys) {
    if (count > 1) {
      addIssue(
        issues,
        "duplicate_link",
        operationalLinkPathFromKey(key),
        "Operational link appears more than once",
      )
    }
  }

  for (const link of overlay.links) {
    const path = operationalLinkPath(link)
    if (!OPERATIONAL_LINK_TYPES.has(link.type)) {
      addIssue(issues, "invalid_link", path, `Unsupported operational link type "${String(link.type)}"`)
      continue
    }
    const endpointsValid = validateEndpoints(link, path, nodeKinds, issues)
    if (endpointsValid) validateOperationalLinkKinds(link, path, nodeKinds, issues)
    if ((operationalLinkKeys.get(operationalLinkKey(link)) ?? 0) === 1) {
      links.push({
        id: stableId("operational_link", [link.type, link.fromNodeId, link.toNodeId]),
        type: link.type,
        fromNodeId: link.fromNodeId,
        toNodeId: link.toNodeId,
      })
    }
  }

  links.sort(compareLinks)
  return { codeNodes, operationalNodes, nodeKinds, links }
}

function validateCausalPaths(candidate: CandidateState, issues: PodoGraphIssue[]): void {
  const paths = new Map<string, PodoCausalPath>()
  const incidents = [...candidate.operationalNodes.values()]
    .filter((node) => node.kind === "incident")
    .sort((left, right) => compareStrings(left.id, right.id))

  for (const incident of incidents) {
    const evidenceLinks = outgoing(candidate, incident.id, "SUPPORTED_BY", "evidence")
    if (evidenceLinks.length === 0) {
      addIssue(
        issues,
        "missing_required_link",
        `causalPath[incident=${incident.id}].incident.SUPPORTED_BY`,
        `Expected at least one SUPPORTED_BY link from "${incident.id}"`,
      )
      continue
    }

    for (const evidenceLink of evidenceLinks) {
      const evidenceId = evidenceLink.toNodeId
      const resolved = resolveCandidatePath(candidate, incident.id, evidenceId)
      if ("issue" in resolved) issues.push(resolved.issue)
      else paths.set(pathKey(incident.id, evidenceId), resolved.path)
    }
  }
  candidate.paths = paths
}

function resolveCandidatePath(
  state: CandidateState,
  incidentId: string,
  evidenceId: string,
): { path: PodoCausalPath } | { issue: PodoGraphIssue } {
  const prefix = `causalPath[incident=${incidentId},evidence=${evidenceId}]`
  const support = matchingLinks(state, incidentId, "SUPPORTED_BY", evidenceId)
  const supportIssue = requireExactlyOne(support, `${prefix}.incident.SUPPORTED_BY`, incidentId, "SUPPORTED_BY")
  if (supportIssue) return { issue: supportIssue }

  const telemetry = uniqueTarget(state, evidenceId, "DERIVED_FROM", "telemetry_event", `${prefix}.evidence.DERIVED_FROM`)
  if ("issue" in telemetry) return telemetry
  const container = uniqueTarget(state, telemetry.id, "OBSERVED_IN", "container", `${prefix}.telemetry.OBSERVED_IN`)
  if ("issue" in container) return container
  const deployment = uniqueTarget(state, container.id, "RUNS", "deployment", `${prefix}.container.RUNS`)
  if ("issue" in deployment) return deployment
  const commit = uniqueTarget(state, deployment.id, "USES", "commit", `${prefix}.deployment.USES`)
  if ("issue" in commit) return commit
  const file = uniqueTarget(state, commit.id, "CHANGED", "file", `${prefix}.commit.CHANGED`)
  if ("issue" in file) return file
  const fn = uniqueTarget(state, file.id, "CONTAINS", "function", `${prefix}.file.CONTAINS`)
  if ("issue" in fn) return fn

  const content = {
    incidentNodeId: incidentId,
    evidenceNodeId: evidenceId,
    telemetryEventNodeId: telemetry.id,
    containerNodeId: container.id,
    deploymentNodeId: deployment.id,
    commitNodeId: commit.id,
    fileNodeId: file.id,
    functionNodeId: fn.id,
    nodeIds: [
      incidentId,
      evidenceId,
      telemetry.id,
      container.id,
      deployment.id,
      commit.id,
      file.id,
      fn.id,
    ],
  }
  return { path: { id: stableId("causal_path", content), ...content } }
}

function uniqueTarget(
  state: CandidateState,
  fromNodeId: string,
  type: StoredLink["type"],
  targetKind: AnyNodeKind,
  path: string,
): { id: string } | { issue: PodoGraphIssue } {
  const links = outgoing(state, fromNodeId, type, targetKind)
  const required = requireExactlyOne(links, path, fromNodeId, type)
  return required ? { issue: required } : { id: links[0]!.toNodeId }
}

function requireExactlyOne(
  links: readonly StoredLink[],
  path: string,
  fromNodeId: string,
  type: StoredLink["type"],
): PodoGraphIssue | null {
  if (links.length === 1) return null
  return {
    code: links.length === 0 ? "missing_required_link" : "ambiguous_required_link",
    path,
    message: `Expected one ${type} link from "${fromNodeId}", found ${links.length}`,
  }
}

function outgoing(
  state: CandidateState,
  fromNodeId: string,
  type: StoredLink["type"],
  targetKind: AnyNodeKind,
): StoredLink[] {
  return state.links.filter(
    (link) =>
      link.fromNodeId === fromNodeId &&
      link.type === type &&
      state.nodeKinds.get(link.toNodeId) === targetKind,
  )
}

function matchingLinks(
  state: CandidateState,
  fromNodeId: string,
  type: StoredLink["type"],
  toNodeId: string,
): StoredLink[] {
  return state.links.filter(
    (link) => link.fromNodeId === fromNodeId && link.type === type && link.toNodeId === toNodeId,
  )
}

function validateEndpoints(
  link: { fromNodeId: string; toNodeId: string },
  path: string,
  nodeKinds: ReadonlyMap<string, AnyNodeKind>,
  issues: PodoGraphIssue[],
): boolean {
  let valid = true
  if (!nodeKinds.has(link.fromNodeId)) {
    addIssue(
      issues,
      "dangling_link",
      `${path}.fromNodeId`,
      `Link source "${link.fromNodeId}" does not identify a node`,
    )
    valid = false
  }
  if (!nodeKinds.has(link.toNodeId)) {
    addIssue(
      issues,
      "dangling_link",
      `${path}.toNodeId`,
      `Link target "${link.toNodeId}" does not identify a node`,
    )
    valid = false
  }
  return valid
}

function validateOperationalLinkKinds(
  link: OperationalGraphLink,
  path: string,
  nodeKinds: ReadonlyMap<string, AnyNodeKind>,
  issues: PodoGraphIssue[],
): void {
  const expected = OPERATIONAL_LINK_KINDS[link.type]
  const actual: readonly [AnyNodeKind | undefined, AnyNodeKind | undefined] = [
    nodeKinds.get(link.fromNodeId),
    nodeKinds.get(link.toNodeId),
  ]
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    addIssue(
      issues,
      "invalid_link",
      path,
      `${link.type} requires ${expected[0]} -> ${expected[1]}, received ${String(actual[0])} -> ${String(actual[1])}`,
    )
  }
}

function canonicalCodeGraph(snapshot: NormalizedCodeGraphSnapshot): NormalizedCodeGraphSnapshot {
  return {
    ...structuredClone(snapshot),
    nodes: [...snapshot.nodes].map((node) => structuredClone(node)).sort(compareNodes),
    links: [...snapshot.links].map((link) => structuredClone(link)).sort(compareCodeLinks),
  }
}

function canonicalOperationalOverlay(overlay: OperationalGraphOverlay): OperationalGraphOverlay {
  return {
    nodes: [...overlay.nodes].map((node) => structuredClone(node)).sort(compareNodes),
    links: [...overlay.links].map((link) => structuredClone(link)).sort((left, right) =>
      compareStrings(operationalLinkKey(left), operationalLinkKey(right))),
  }
}

function countIds(values: readonly { id: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value.id, (counts.get(value.id) ?? 0) + 1)
  return new Map([...counts.entries()].sort(([left], [right]) => compareStrings(left, right)))
}

function operationalLinkKey(link: OperationalGraphLink): string {
  return `${link.type}\u0000${link.fromNodeId}\u0000${link.toNodeId}`
}

function operationalLinkPath(link: OperationalGraphLink): string {
  return `operationalOverlay.links[type=${link.type},from=${link.fromNodeId},to=${link.toNodeId}]`
}

function operationalLinkPathFromKey(key: string): string {
  const [type, fromNodeId, toNodeId] = key.split("\u0000")
  return `operationalOverlay.links[type=${type},from=${fromNodeId},to=${toNodeId}]`
}

function pathKey(incidentId: string, evidenceId: string): string {
  return `${incidentId}\u0000${evidenceId}`
}

function addIssue(
  issues: PodoGraphIssue[],
  code: PodoGraphIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message })
}

function sortIssues(issues: PodoGraphIssue[]): PodoGraphIssue[] {
  return issues.sort((left, right) => {
    const leftKey = `${left.path}\u0000${left.code}\u0000${left.message}`
    const rightKey = `${right.path}\u0000${right.code}\u0000${right.message}`
    return compareStrings(leftKey, rightKey)
  })
}

function unresolved(issues: PodoGraphIssue[]): PodoCausalPathResult {
  return {
    ok: false,
    rejection: {
      code: "PODO_CAUSAL_PATH_UNRESOLVED",
      issues: sortIssues(issues),
    },
  }
}

function stableId(prefix: string, value: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 24)
  return `${prefix}_${hash}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function compareNodes(left: { id: string }, right: { id: string }): number {
  return compareStrings(left.id, right.id)
}

function compareCodeLinks(left: NormalizedCodeGraphLink, right: NormalizedCodeGraphLink): number {
  return compareStrings(left.id, right.id)
}

function compareLinks(left: StoredLink, right: StoredLink): number {
  return compareStrings(left.id, right.id)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
