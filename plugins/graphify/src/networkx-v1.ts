import type {
  GraphifyImportIssue,
  GraphifyImportResult,
  GraphifyNodeInput,
  GraphifyProvenance,
  GraphifyRelationInput,
  GraphifySourceLocation,
} from "./graph"
import { GRAPHIFY_SCHEMA_VERSION, normalizeGraphifyGraph } from "./graph"

export const GRAPHIFY_NETWORKX_DECODER_VERSION = "networkx-v1" as const

export interface GraphifyNetworkxDecodeOptions {
  graphId: string
}

type UnknownRecord = Record<string, unknown>

interface RawNode {
  id: string
  label: string
  fileType: "code" | "document"
  sourcePath: string
  sourceLocation?: string
}

interface RawLink {
  relation: string
  sourceId: string
  targetId: string
  networkxSourceId: string
  networkxTargetId: string
  confidence: GraphifyProvenance
  confidenceScore: number
  sourcePath: string
  sourceLocation?: string
}

const TOP_LEVEL_FIELDS = new Set([
  "directed",
  "multigraph",
  "graph",
  "hyperedges",
  "nodes",
  "links",
])
const GRAPH_FIELDS = new Set(["hyperedges"])
const NODE_FIELDS = new Set([
  "author",
  "captured_at",
  "community",
  "contributor",
  "file_type",
  "id",
  "label",
  "norm_label",
  "source_file",
  "source_location",
  "source_url",
])
const LINK_FIELDS = new Set([
  "_src",
  "_tgt",
  "confidence",
  "confidence_score",
  "relation",
  "source",
  "source_file",
  "source_location",
  "target",
  "weight",
])
const HYPEREDGE_FIELDS = new Set([
  "confidence",
  "confidence_score",
  "id",
  "label",
  "nodes",
  "relation",
  "source_file",
])

const RAW_RELATIONS = new Map<string, GraphifyRelationInput["type"]>([
  ["contains", "CONTAINS"],
  ["method", "CONTAINS"],
  ["calls", "CALLS"],
])

export function decodeGraphifyNetworkxV1(
  input: unknown,
  options: GraphifyNetworkxDecodeOptions,
): GraphifyImportResult {
  const issues: GraphifyImportIssue[] = []
  if (!isRecord(input)) return rejected([rawIssue("invalid_type", "$", "Raw graph must be an object")])

  rejectUnknownFields(input, TOP_LEVEL_FIELDS, "$", issues)
  if (input.directed !== false) {
    issues.push(rawIssue("unsupported_value", "raw.directed", "networkx-v1 requires directed=false"))
  }
  if (input.multigraph !== false) {
    issues.push(rawIssue("unsupported_value", "raw.multigraph", "networkx-v1 requires multigraph=false"))
  }
  validateGraphMetadata(input.graph, issues)
  if (!Array.isArray(input.hyperedges)) {
    issues.push(rawIssue("invalid_type", "raw.hyperedges", "hyperedges must be an array"))
  } else if (
    isRecord(input.graph) &&
    Array.isArray(input.graph.hyperedges) &&
    JSON.stringify(input.hyperedges) !== JSON.stringify(input.graph.hyperedges)
  ) {
    issues.push(rawIssue(
      "conflicting_external_id",
      "raw.hyperedges",
      "Top-level and graph.hyperedges must contain the same data",
    ))
  }
  if (!nonEmpty(options.graphId)) {
    issues.push(rawIssue("missing_value", "options.graphId", "graphId must be non-empty"))
  }

  const rawNodes = parseRawNodes(input.nodes, issues)
  const rawNodeIds = new Set(rawNodes.map((node) => node.id))
  validateRawHyperedges(input.hyperedges, rawNodeIds, issues)
  const rawLinks = parseRawLinks(input.links, rawNodeIds, issues)

  const codeNodes = rawNodes.filter((node) => node.fileType === "code")
  const codeNodeIds = new Set(codeNodes.map((node) => node.id))
  const identities = deriveRepositoryIdentity(codeNodes, issues)
  const nodes = identities ? normalizeNodes(codeNodes, identities, issues) : []
  const relations = identities
    ? normalizeRelations(rawLinks, codeNodeIds, nodes, identities, issues)
    : []

  if (issues.length > 0) return rejected(issues)

  return normalizeGraphifyGraph({
    schemaVersion: GRAPHIFY_SCHEMA_VERSION,
    graphId: options.graphId,
    nodes,
    relations,
  })
}

function validateRawHyperedges(
  value: unknown,
  nodeIds: ReadonlySet<string>,
  issues: GraphifyImportIssue[],
): void {
  if (!Array.isArray(value)) return
  const idCounts = new Map<string, number>()
  value.forEach((item, index) => {
    const fallbackPath = `raw.hyperedges[index=${index}]`
    if (!isRecord(item)) {
      issues.push(rawIssue("invalid_type", fallbackPath, "Hyperedge must be an object"))
      return
    }
    const id = text(item.id)
    const path = id ? `raw.hyperedges[id=${id}]` : fallbackPath
    rejectUnknownFields(item, HYPEREDGE_FIELDS, path, issues)
    if (!id) issues.push(rawIssue("missing_value", `${path}.id`, "Hyperedge ID must be non-empty"))
    if (!text(item.label)) issues.push(rawIssue("missing_value", `${path}.label`, "Hyperedge label must be non-empty"))
    if (!text(item.relation)) issues.push(rawIssue("missing_value", `${path}.relation`, "Hyperedge relation must be non-empty"))
    parseRawPath(item.source_file, `${path}.source_file`, issues)
    parseConfidence(item.confidence, `${path}.confidence`, issues)
    if (
      typeof item.confidence_score !== "number" ||
      !Number.isFinite(item.confidence_score) ||
      item.confidence_score < 0 ||
      item.confidence_score > 1
    ) {
      issues.push(rawIssue(
        "unsupported_value",
        `${path}.confidence_score`,
        "confidence_score must be a finite number from 0 to 1",
      ))
    }
    if (!Array.isArray(item.nodes) || item.nodes.length === 0) {
      issues.push(rawIssue("invalid_type", `${path}.nodes`, "Hyperedge nodes must be a non-empty array"))
    } else {
      item.nodes.forEach((nodeId, nodeIndex) => {
        if (!text(nodeId)) {
          issues.push(rawIssue(
            "invalid_type",
            `${path}.nodes[index=${nodeIndex}]`,
            "Hyperedge node ID must be non-empty",
          ))
        } else if (!nodeIds.has(nodeId)) {
          issues.push(rawIssue(
            "dangling_endpoint",
            `${path}.nodes[id=${nodeId}]`,
            `Hyperedge node "${nodeId}" does not identify a raw node`,
          ))
        }
      })
    }
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  })
  for (const [id, count] of [...idCounts.entries()].sort(([left], [right]) => compare(left, right))) {
    if (count > 1) {
      issues.push(rawIssue(
        "conflicting_external_id",
        `raw.hyperedges[id=${id}]`,
        `Hyperedge ID "${id}" appears more than once`,
      ))
    }
  }
}

function validateGraphMetadata(value: unknown, issues: GraphifyImportIssue[]): void {
  if (!isRecord(value)) {
    issues.push(rawIssue("invalid_type", "raw.graph", "graph must be an object"))
    return
  }
  rejectUnknownFields(value, GRAPH_FIELDS, "raw.graph", issues)
  if (!Array.isArray(value.hyperedges)) {
    issues.push(rawIssue("invalid_type", "raw.graph.hyperedges", "hyperedges must be an array"))
  }
}

function parseRawNodes(value: unknown, issues: GraphifyImportIssue[]): RawNode[] {
  if (!Array.isArray(value)) {
    issues.push(rawIssue("invalid_type", "raw.nodes", "nodes must be an array"))
    return []
  }

  const parsed: RawNode[] = []
  const idCounts = new Map<string, number>()
  value.forEach((item, index) => {
    const fallbackPath = `raw.nodes[index=${index}]`
    if (!isRecord(item)) {
      issues.push(rawIssue("invalid_type", fallbackPath, "Raw node must be an object"))
      return
    }
    const id = text(item.id)
    const path = id ? `raw.nodes[id=${id}]` : fallbackPath
    rejectUnknownFields(item, NODE_FIELDS, path, issues)
    if (!id) issues.push(rawIssue("missing_value", `${path}.id`, "Raw node ID must be non-empty"))
    const label = text(item.label)
    if (!label) issues.push(rawIssue("missing_value", `${path}.label`, "Raw node label must be non-empty"))
    const fileType = item.file_type
    if (fileType !== "code" && fileType !== "document") {
      issues.push(rawIssue("unsupported_value", `${path}.file_type`, `Unsupported file_type ${describe(fileType)}`))
    }
    const sourcePath = parseRawPath(item.source_file, `${path}.source_file`, issues)
    const sourceLocation = parseLocationToken(item.source_location, `${path}.source_location`, issues)
    validateOptionalNodeMetadata(item, path, issues)

    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    if (id && label && (fileType === "code" || fileType === "document") && sourcePath) {
      parsed.push({
        id,
        label,
        fileType,
        sourcePath,
        ...(sourceLocation ? { sourceLocation } : {}),
      })
    }
  })

  for (const [id, count] of [...idCounts.entries()].sort(([left], [right]) => compare(left, right))) {
    if (count > 1) {
      issues.push(rawIssue(
        "conflicting_external_id",
        `raw.nodes[id=${id}]`,
        `Raw node ID "${id}" appears more than once`,
      ))
    }
  }
  return parsed
}

function parseRawLinks(
  value: unknown,
  nodeIds: ReadonlySet<string>,
  issues: GraphifyImportIssue[],
): RawLink[] {
  if (!Array.isArray(value)) {
    issues.push(rawIssue("invalid_type", "raw.links", "links must be an array"))
    return []
  }

  const parsed: RawLink[] = []
  const identityCounts = new Map<string, number>()
  value.forEach((item, index) => {
    const fallbackPath = `raw.links[index=${index}]`
    if (!isRecord(item)) {
      issues.push(rawIssue("invalid_type", fallbackPath, "Raw link must be an object"))
      return
    }
    const relation = text(item.relation)
    const sourceId = text(item._src)
    const targetId = text(item._tgt)
    const path = relation && sourceId && targetId
      ? rawLinkPath(relation, sourceId, targetId)
      : fallbackPath
    rejectUnknownFields(item, LINK_FIELDS, path, issues)
    if (!relation) issues.push(rawIssue("missing_value", `${path}.relation`, "relation must be non-empty"))
    if (!sourceId) issues.push(rawIssue("missing_value", `${path}._src`, "_src must be non-empty"))
    if (!targetId) issues.push(rawIssue("missing_value", `${path}._tgt`, "_tgt must be non-empty"))

    const networkxSourceId = text(item.source)
    const networkxTargetId = text(item.target)
    if (!networkxSourceId) issues.push(rawIssue("missing_value", `${path}.source`, "source must be non-empty"))
    if (!networkxTargetId) issues.push(rawIssue("missing_value", `${path}.target`, "target must be non-empty"))
    if (
      sourceId &&
      targetId &&
      networkxSourceId &&
      networkxTargetId &&
      !sameUnorderedPair(sourceId, targetId, networkxSourceId, networkxTargetId)
    ) {
      issues.push(rawIssue(
        "conflicting_external_id",
        path,
        "NetworkX source/target endpoints conflict with semantic _src/_tgt endpoints",
      ))
    }

    if (sourceId && !nodeIds.has(sourceId)) {
      issues.push(rawIssue(
        "dangling_endpoint",
        `${path}.source`,
        `Raw relation source "${sourceId}" does not identify a node`,
      ))
    }
    if (targetId && !nodeIds.has(targetId)) {
      issues.push(rawIssue(
        "dangling_endpoint",
        `${path}.target`,
        `Supported relation target "${targetId}" does not identify a code node`,
      ))
    }

    const confidence = parseConfidence(item.confidence, `${path}.confidence`, issues)
    const confidenceScore = item.confidence_score
    if (typeof confidenceScore !== "number" || !Number.isFinite(confidenceScore) || confidenceScore < 0 || confidenceScore > 1) {
      issues.push(rawIssue(
        "unsupported_value",
        `${path}.confidence_score`,
        "confidence_score must be a finite number from 0 to 1",
      ))
    }
    if (typeof item.weight !== "number" || !Number.isFinite(item.weight)) {
      issues.push(rawIssue("invalid_type", `${path}.weight`, "weight must be a finite number"))
    }
    const sourcePath = parseRawPath(item.source_file, `${path}.source_file`, issues)
    const sourceLocation = parseLocationToken(item.source_location, `${path}.source_location`, issues)

    if (relation && sourceId && targetId) {
      const identity = `${relation}\u0000${sourceId}\u0000${targetId}`
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1)
    }
    if (
      relation &&
      sourceId &&
      targetId &&
      networkxSourceId &&
      networkxTargetId &&
      confidence &&
      typeof confidenceScore === "number" &&
      sourcePath
    ) {
      parsed.push({
        relation,
        sourceId,
        targetId,
        networkxSourceId,
        networkxTargetId,
        confidence,
        confidenceScore,
        sourcePath,
        ...(sourceLocation ? { sourceLocation } : {}),
      })
    }
  })

  for (const [identity, count] of [...identityCounts.entries()].sort(([left], [right]) => compare(left, right))) {
    if (count <= 1) continue
    const [relation, sourceId, targetId] = identity.split("\u0000")
    issues.push(rawIssue(
      "conflicting_external_id",
      rawLinkPath(relation!, sourceId!, targetId!),
      "Raw relation identity appears more than once",
    ))
  }
  return parsed
}

function validateOptionalNodeMetadata(
  node: UnknownRecord,
  path: string,
  issues: GraphifyImportIssue[],
): void {
  if (typeof node.community !== "number" || !Number.isInteger(node.community)) {
    issues.push(rawIssue("invalid_type", `${path}.community`, "community must be an integer"))
  }
  if (typeof node.norm_label !== "string") {
    issues.push(rawIssue("invalid_type", `${path}.norm_label`, "norm_label must be a string"))
  }
  for (const key of ["author", "captured_at", "contributor", "source_url"] as const) {
    if (node[key] !== undefined && node[key] !== null && typeof node[key] !== "string") {
      issues.push(rawIssue("invalid_type", `${path}.${key}`, `${key} must be a string when present`))
    }
  }
}

interface RepositoryIdentity {
  repository: string
  services: string[]
  serviceByNodeId: Map<string, string>
}

function deriveRepositoryIdentity(
  codeNodes: readonly RawNode[],
  issues: GraphifyImportIssue[],
): RepositoryIdentity | null {
  const repositories = new Set<string>()
  const services = new Set<string>()
  const serviceByNodeId = new Map<string, string>()
  for (const node of codeNodes) {
    const match = /^([^/]+)\/services\/([^/]+)\/.+\.ts$/.exec(node.sourcePath)
    if (!match) {
      issues.push(rawIssue(
        "ambiguous_value",
        `raw.nodes[id=${node.id}].source_file`,
        `Cannot derive repository and service from "${node.sourcePath}"`,
      ))
      continue
    }
    repositories.add(match[1]!)
    services.add(match[2]!)
    serviceByNodeId.set(node.id, match[2]!)
  }
  if (repositories.size !== 1) {
    issues.push(rawIssue(
      "ambiguous_value",
      "raw.nodes.source_file",
      `Expected one repository root, found ${repositories.size}`,
    ))
    return null
  }
  return {
    repository: [...repositories][0]!,
    services: [...services].sort(compare),
    serviceByNodeId,
  }
}

function normalizeNodes(
  rawNodes: readonly RawNode[],
  identities: RepositoryIdentity,
  issues: GraphifyImportIssue[],
): GraphifyNodeInput[] {
  const nodes: GraphifyNodeInput[] = [{
    id: repositoryId(identities.repository),
    kind: "repository",
    name: identities.repository,
    provenance: "inferred",
  }]
  for (const service of identities.services) {
    nodes.push({
      id: serviceId(identities.repository, service),
      kind: "service",
      name: service,
      provenance: "inferred",
    })
  }

  const fileIdsByPath = new Map<string, string[]>()
  for (const raw of rawNodes) {
    if (raw.label !== basename(raw.sourcePath)) continue
    const ids = fileIdsByPath.get(raw.sourcePath) ?? []
    ids.push(raw.id)
    fileIdsByPath.set(raw.sourcePath, ids)
  }
  for (const [sourcePath, ids] of [...fileIdsByPath.entries()].sort(([left], [right]) =>
    compare(left, right))) {
    if (ids.length > 1) {
      issues.push(rawIssue(
        "ambiguous_value",
        `raw.nodes[source_file=${sourcePath}]`,
        `Source file "${sourcePath}" identifies multiple file nodes: ${ids.sort(compare).join(", ")}`,
      ))
    }
  }

  for (const raw of rawNodes) {
    const kind = raw.label === basename(raw.sourcePath) ? "file" : "function"
    const location = toLocation(raw.sourcePath, raw.sourceLocation)
    nodes.push({
      id: raw.id,
      kind,
      name: raw.label,
      provenance: "extracted",
      ...(location ? { location } : {}),
    })
  }
  return nodes
}

function normalizeRelations(
  rawLinks: readonly RawLink[],
  codeNodeIds: ReadonlySet<string>,
  normalizedNodes: readonly GraphifyNodeInput[],
  identities: RepositoryIdentity,
  issues: GraphifyImportIssue[],
): GraphifyRelationInput[] {
  const relations: GraphifyRelationInput[] = []
  for (const service of identities.services) {
    relations.push({
      id: `networkx:repository-service:${identities.repository}:${service}`,
      type: "CONTAINS",
      from: repositoryId(identities.repository),
      to: serviceId(identities.repository, service),
      provenance: "inferred",
    })
  }

  for (const node of normalizedNodes) {
    if (node.kind !== "file") continue
    const service = identities.serviceByNodeId.get(node.id)
    if (!service) {
      issues.push(rawIssue(
        "ambiguous_value",
        `normalized.nodes[id=${node.id}]`,
        "File node has no derived service identity",
      ))
      continue
    }
    relations.push({
      id: `networkx:service-file:${service}:${node.id}`,
      type: "OWNS",
      from: serviceId(identities.repository, service),
      to: node.id,
      provenance: "inferred",
      ...(node.location ? { location: node.location } : {}),
    })
  }

  for (const raw of rawLinks) {
    const type = RAW_RELATIONS.get(raw.relation)
    if (!type) continue
    if (!codeNodeIds.has(raw.sourceId)) {
      issues.push(rawIssue(
        "dangling_endpoint",
        `${rawLinkPath(raw.relation, raw.sourceId, raw.targetId)}.source`,
        `Supported relation source "${raw.sourceId}" does not identify a code node`,
      ))
      continue
    }
    if (!codeNodeIds.has(raw.targetId)) {
      issues.push(rawIssue(
        "dangling_endpoint",
        `${rawLinkPath(raw.relation, raw.sourceId, raw.targetId)}.target`,
        `Supported relation target "${raw.targetId}" does not identify a code node`,
      ))
      continue
    }
    const location = toLocation(raw.sourcePath, raw.sourceLocation)
    relations.push({
      id: `networkx:${raw.relation}:${raw.sourceId}:${raw.targetId}`,
      type,
      from: raw.sourceId,
      to: raw.targetId,
      provenance: raw.confidence,
      ...(location ? { location } : {}),
    })
  }
  return relations
}

function parseConfidence(
  value: unknown,
  path: string,
  issues: GraphifyImportIssue[],
): GraphifyProvenance | undefined {
  if (value === "EXTRACTED") return "extracted"
  if (value === "INFERRED") return "inferred"
  if (value === "AMBIGUOUS") return "ambiguous"
  issues.push(rawIssue("unsupported_value", path, `Unsupported confidence ${describe(value)}`))
  return undefined
}

function parseRawPath(
  value: unknown,
  path: string,
  issues: GraphifyImportIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issues.push(rawIssue("invalid_type", path, "source_file must be a string"))
    return undefined
  }
  const normalized = value.replaceAll("\\", "/")
  const segments = normalized.split("/")
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    issues.push(rawIssue(
      "invalid_location",
      path,
      "source_file must be a normalized repository-relative path",
    ))
    return undefined
  }
  return normalized
}

function parseLocationToken(
  value: unknown,
  path: string,
  issues: GraphifyImportIssue[],
): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== "string" || !/^L[1-9]\d*$/.test(value)) {
    issues.push(rawIssue(
      "invalid_location",
      path,
      `Expected source_location in "L<n>" form, received ${describe(value)}`,
    ))
    return undefined
  }
  return value
}

function toLocation(path: string, token: string | undefined): GraphifySourceLocation | undefined {
  if (!token) return undefined
  return { path, line: Number(token.slice(1)) }
}

function rejectUnknownFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: GraphifyImportIssue[],
): void {
  for (const key of Object.keys(value).sort(compare)) {
    if (!allowed.has(key)) {
      issues.push(rawIssue("unknown_field", `${path}.${key}`, `Unknown field "${key}"`))
    }
  }
}

function rejected(issues: GraphifyImportIssue[]): GraphifyImportResult {
  return {
    ok: false,
    rejection: {
      code: "GRAPHIFY_IMPORT_REJECTED",
      issues: issues.sort((left, right) => compare(
        `${left.path}\u0000${left.code}\u0000${left.message}`,
        `${right.path}\u0000${right.code}\u0000${right.message}`,
      )),
    },
  }
}

function rawIssue(
  code: GraphifyImportIssue["code"],
  path: string,
  message: string,
): GraphifyImportIssue {
  return { code, path, message }
}

function rawLinkPath(relation: string, sourceId: string, targetId: string): string {
  return `raw.links[relation=${relation},source=${sourceId},target=${targetId}]`
}

function repositoryId(repository: string): string {
  return `networkx:repository:${repository}`
}

function serviceId(repository: string, service: string): string {
  return `networkx:service:${repository}:${service}`
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function sameUnorderedPair(
  leftSource: string,
  leftTarget: string,
  rightSource: string,
  rightTarget: string,
): boolean {
  return (
    (leftSource === rightSource && leftTarget === rightTarget) ||
    (leftSource === rightTarget && leftTarget === rightSource)
  )
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function describe(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
