import { createHash } from "node:crypto"

export const GRAPHIFY_SCHEMA_VERSION = "1.0" as const
export const ROOTLINE_CODE_GRAPH_SCHEMA_VERSION = "rootline.code-graph.v1" as const

export const GRAPHIFY_NODE_KINDS = [
  "repository",
  "service",
  "file",
  "function",
  "endpoint",
] as const

export const GRAPHIFY_RELATION_TYPES = [
  "CONTAINS",
  "OWNS",
  "IMPORTS",
  "CALLS",
  "EXPOSES",
] as const

export const GRAPHIFY_PROVENANCE_VALUES = ["extracted", "inferred", "ambiguous"] as const

export type GraphifyNodeKind = (typeof GRAPHIFY_NODE_KINDS)[number]
export type GraphifyRelationType = (typeof GRAPHIFY_RELATION_TYPES)[number]
export type GraphifyProvenance = (typeof GRAPHIFY_PROVENANCE_VALUES)[number]

export interface GraphifySourceLocation {
  path: string
  line: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface GraphifyNodeInput {
  id: string
  kind: GraphifyNodeKind
  name: string
  provenance: GraphifyProvenance
  location?: GraphifySourceLocation
}

export interface GraphifyRelationInput {
  id: string
  type: GraphifyRelationType
  from: string
  to: string
  provenance: GraphifyProvenance
  location?: GraphifySourceLocation
}

export interface GraphifyGraphInput {
  schemaVersion: typeof GRAPHIFY_SCHEMA_VERSION
  graphId: string
  nodes: readonly GraphifyNodeInput[]
  relations: readonly GraphifyRelationInput[]
}

export interface RootlineCodeGraphNode {
  id: string
  externalId: string
  kind: GraphifyNodeKind
  label: string
  provenance: GraphifyProvenance
  location?: GraphifySourceLocation
}

export interface RootlineCodeGraphLink {
  id: string
  externalId: string
  type: GraphifyRelationType
  fromNodeId: string
  toNodeId: string
  fromExternalId: string
  toExternalId: string
  provenance: GraphifyProvenance
  location?: GraphifySourceLocation
}

export interface RootlineCodeGraphSnapshot {
  id: string
  schemaVersion: typeof ROOTLINE_CODE_GRAPH_SCHEMA_VERSION
  source: {
    provider: "graphify"
    graphId: string
    schemaVersion: typeof GRAPHIFY_SCHEMA_VERSION
  }
  nodes: RootlineCodeGraphNode[]
  links: RootlineCodeGraphLink[]
}

export type GraphifyImportIssueCode =
  | "invalid_type"
  | "missing_value"
  | "unknown_field"
  | "unsupported_value"
  | "unsupported_schema_version"
  | "invalid_location"
  | "duplicate_external_id"
  | "conflicting_external_id"
  | "dangling_endpoint"

export interface GraphifyImportIssue {
  code: GraphifyImportIssueCode
  path: string
  message: string
}

export type GraphifyImportResult =
  | { ok: true; snapshot: RootlineCodeGraphSnapshot }
  | {
      ok: false
      rejection: {
        code: "GRAPHIFY_IMPORT_REJECTED"
        issues: GraphifyImportIssue[]
      }
    }

const NODE_KIND_SET = new Set<string>(GRAPHIFY_NODE_KINDS)
const RELATION_TYPE_SET = new Set<string>(GRAPHIFY_RELATION_TYPES)
const PROVENANCE_SET = new Set<string>(GRAPHIFY_PROVENANCE_VALUES)

const TOP_LEVEL_FIELDS = new Set(["schemaVersion", "graphId", "nodes", "relations"])
const NODE_FIELDS = new Set(["id", "kind", "name", "provenance", "location"])
const RELATION_FIELDS = new Set(["id", "type", "from", "to", "provenance", "location"])
const LOCATION_FIELDS = new Set(["path", "line", "column", "endLine", "endColumn"])

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function issue(
  issues: GraphifyImportIssue[],
  code: GraphifyImportIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message })
}

function describe(value: unknown): string {
  if (typeof value === "string") return `"${value}"`
  if (value === undefined) return "undefined"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function rejectUnknownFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: GraphifyImportIssue[],
): void {
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) {
      issue(issues, "unknown_field", `${path}.${key}`, `Unknown field "${key}"`)
    }
  }
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: GraphifyImportIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issue(issues, "invalid_type", path, `Expected a string, received ${describe(value)}`)
    return undefined
  }
  if (value.trim().length === 0) {
    issue(issues, "missing_value", path, "Expected a non-empty string")
    return undefined
  }
  return value
}

function itemPath(collection: "nodes" | "relations", value: unknown, index: number): string {
  if (isRecord(value) && typeof value.id === "string" && value.id.trim().length > 0) {
    return `${collection}[id=${value.id}]`
  }
  return `${collection}[index=${index}]`
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isNormalizedRepositoryPath(path: string): boolean {
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:\//.test(path) ||
    path.includes("\\") ||
    path.length === 0 ||
    path !== path.trim()
  ) {
    return false
  }
  const segments = path.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function parseLocation(
  value: unknown,
  path: string,
  issues: GraphifyImportIssue[],
): GraphifySourceLocation | undefined {
  if (!isRecord(value)) {
    issue(issues, "invalid_location", path, "location must be an object")
    return undefined
  }

  const startIssueCount = issues.length
  rejectUnknownFields(value, LOCATION_FIELDS, path, issues)

  const sourcePath = value.path
  if (typeof sourcePath !== "string" || !isNormalizedRepositoryPath(sourcePath)) {
    issue(
      issues,
      "invalid_location",
      `${path}.path`,
      "path must be a normalized repository-relative path",
    )
  }

  const line = value.line
  if (!isPositiveInteger(line)) {
    issue(issues, "invalid_location", `${path}.line`, "line must be a positive integer")
  }

  const column = value.column
  if (column !== undefined && !isPositiveInteger(column)) {
    issue(issues, "invalid_location", `${path}.column`, "column must be a positive integer")
  }

  const endLine = value.endLine
  if (endLine !== undefined && !isPositiveInteger(endLine)) {
    issue(issues, "invalid_location", `${path}.endLine`, "endLine must be a positive integer")
  }

  const endColumn = value.endColumn
  if (endColumn !== undefined && !isPositiveInteger(endColumn)) {
    issue(
      issues,
      "invalid_location",
      `${path}.endColumn`,
      "endColumn must be a positive integer",
    )
  }
  if (endColumn !== undefined && endLine === undefined) {
    issue(issues, "invalid_location", `${path}.endColumn`, "endColumn requires endLine")
  }

  if (isPositiveInteger(line) && isPositiveInteger(endLine) && endLine < line) {
    issue(issues, "invalid_location", `${path}.endLine`, "endLine must not precede line")
  }
  if (
    isPositiveInteger(line) &&
    isPositiveInteger(column) &&
    endLine === line &&
    isPositiveInteger(endColumn) &&
    endColumn < column
  ) {
    issue(
      issues,
      "invalid_location",
      `${path}.endColumn`,
      "endColumn must not precede column on the same line",
    )
  }

  if (issues.length !== startIssueCount) return undefined

  const location: GraphifySourceLocation = {
    path: sourcePath as string,
    line: line as number,
  }
  if (column !== undefined) location.column = column as number
  if (endLine !== undefined) location.endLine = endLine as number
  if (endColumn !== undefined) location.endColumn = endColumn as number
  return location
}

function parseProvenance(
  value: unknown,
  path: string,
  issues: GraphifyImportIssue[],
): GraphifyProvenance | undefined {
  if (typeof value !== "string" || !PROVENANCE_SET.has(value)) {
    issue(
      issues,
      "unsupported_value",
      path,
      `Unsupported provenance ${describe(value)}`,
    )
    return undefined
  }
  return value as GraphifyProvenance
}

function parseNode(
  value: unknown,
  index: number,
  issues: GraphifyImportIssue[],
): GraphifyNodeInput | undefined {
  const path = itemPath("nodes", value, index)
  if (!isRecord(value)) {
    issue(issues, "invalid_type", path, "Node must be an object")
    return undefined
  }

  const startIssueCount = issues.length
  rejectUnknownFields(value, NODE_FIELDS, path, issues)
  const id = nonEmptyString(value.id, `${path}.id`, issues)
  const name = nonEmptyString(value.name, `${path}.name`, issues)

  let kind: GraphifyNodeKind | undefined
  if (typeof value.kind !== "string" || !NODE_KIND_SET.has(value.kind)) {
    issue(
      issues,
      "unsupported_value",
      `${path}.kind`,
      `Unsupported node kind ${describe(value.kind)}`,
    )
  } else {
    kind = value.kind as GraphifyNodeKind
  }

  const provenance = parseProvenance(value.provenance, `${path}.provenance`, issues)
  const location =
    value.location === undefined
      ? undefined
      : parseLocation(value.location, `${path}.location`, issues)

  if (issues.length !== startIssueCount || !id || !name || !kind || !provenance) return undefined

  const parsed: GraphifyNodeInput = { id, kind, name, provenance }
  if (location !== undefined) parsed.location = location
  return parsed
}

function parseRelation(
  value: unknown,
  index: number,
  issues: GraphifyImportIssue[],
): GraphifyRelationInput | undefined {
  const path = itemPath("relations", value, index)
  if (!isRecord(value)) {
    issue(issues, "invalid_type", path, "Relation must be an object")
    return undefined
  }

  const startIssueCount = issues.length
  rejectUnknownFields(value, RELATION_FIELDS, path, issues)
  const id = nonEmptyString(value.id, `${path}.id`, issues)
  const from = nonEmptyString(value.from, `${path}.from`, issues)
  const to = nonEmptyString(value.to, `${path}.to`, issues)

  let type: GraphifyRelationType | undefined
  if (typeof value.type !== "string" || !RELATION_TYPE_SET.has(value.type)) {
    issue(
      issues,
      "unsupported_value",
      `${path}.type`,
      `Unsupported relation type ${describe(value.type)}`,
    )
  } else {
    type = value.type as GraphifyRelationType
  }

  const provenance = parseProvenance(value.provenance, `${path}.provenance`, issues)
  const location =
    value.location === undefined
      ? undefined
      : parseLocation(value.location, `${path}.location`, issues)

  if (issues.length !== startIssueCount || !id || !from || !to || !type || !provenance) {
    return undefined
  }

  const parsed: GraphifyRelationInput = { id, type, from, to, provenance }
  if (location !== undefined) parsed.location = location
  return parsed
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function contentId(prefix: string, value: unknown): string {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 24)
  return `${prefix}_${digest}`
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function addIdentityIssues<T extends { id: string }>(
  values: readonly T[],
  collection: "nodes" | "relations",
  issues: GraphifyImportIssue[],
): void {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const group = groups.get(value.id)
    if (group) group.push(value)
    else groups.set(value.id, [value])
  }

  for (const [externalId, group] of [...groups.entries()].sort(([a], [b]) =>
    compareStrings(a, b),
  )) {
    if (group.length < 2) continue
    const variants = new Set(group.map(canonicalJson))
    if (variants.size === 1) {
      issue(
        issues,
        "duplicate_external_id",
        `${collection}[id=${externalId}]`,
        `External ${collection === "nodes" ? "node" : "relation"} ID "${externalId}" appears more than once`,
      )
    } else {
      issue(
        issues,
        "conflicting_external_id",
        `${collection}[id=${externalId}]`,
        `External ${collection === "nodes" ? "node" : "relation"} ID "${externalId}" identifies conflicting ${collection}`,
      )
    }
  }
}

function sortIssues(issues: GraphifyImportIssue[]): GraphifyImportIssue[] {
  return issues.sort((left, right) => {
    const leftKey = `${left.path}\u0000${left.code}\u0000${left.message}`
    const rightKey = `${right.path}\u0000${right.code}\u0000${right.message}`
    return compareStrings(leftKey, rightKey)
  })
}

/**
 * Validate and atomically normalize one Graphify code-graph export.
 *
 * The function is intentionally pure: callers own persistence, audit events,
 * and retry policy. A rejected import never contains a partial snapshot.
 */
export function normalizeGraphifyGraph(input: unknown): GraphifyImportResult {
  const issues: GraphifyImportIssue[] = []
  if (!isRecord(input)) {
    return {
      ok: false,
      rejection: {
        code: "GRAPHIFY_IMPORT_REJECTED",
        issues: [{ code: "invalid_type", path: "$", message: "Graph payload must be an object" }],
      },
    }
  }

  rejectUnknownFields(input, TOP_LEVEL_FIELDS, "$", issues)

  if (input.schemaVersion !== GRAPHIFY_SCHEMA_VERSION) {
    issue(
      issues,
      "unsupported_schema_version",
      "schemaVersion",
      `Unsupported Graphify schema version ${describe(input.schemaVersion)}; expected "${GRAPHIFY_SCHEMA_VERSION}"`,
    )
  }
  const graphId = nonEmptyString(input.graphId, "graphId", issues)

  const nodeIssueStart = issues.length
  const nodes: GraphifyNodeInput[] = []
  if (!Array.isArray(input.nodes)) {
    issue(issues, "invalid_type", "nodes", "nodes must be an array")
  } else {
    input.nodes.forEach((value, index) => {
      const parsed = parseNode(value, index, issues)
      if (parsed) nodes.push(parsed)
    })
  }
  const nodesStructurallyValid = issues.length === nodeIssueStart

  const relations: GraphifyRelationInput[] = []
  if (!Array.isArray(input.relations)) {
    issue(issues, "invalid_type", "relations", "relations must be an array")
  } else {
    input.relations.forEach((value, index) => {
      const parsed = parseRelation(value, index, issues)
      if (parsed) relations.push(parsed)
    })
  }

  addIdentityIssues(nodes, "nodes", issues)
  addIdentityIssues(relations, "relations", issues)

  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodesStructurallyValid && nodeIds.size === nodes.length) {
    for (const relation of relations) {
      if (!nodeIds.has(relation.from)) {
        issue(
          issues,
          "dangling_endpoint",
          `relations[id=${relation.id}].from`,
          `Relation endpoint "${relation.from}" does not identify a node`,
        )
      }
      if (!nodeIds.has(relation.to)) {
        issue(
          issues,
          "dangling_endpoint",
          `relations[id=${relation.id}].to`,
          `Relation endpoint "${relation.to}" does not identify a node`,
        )
      }
    }
  }

  if (issues.length > 0 || !graphId) {
    return {
      ok: false,
      rejection: { code: "GRAPHIFY_IMPORT_REJECTED", issues: sortIssues(issues) },
    }
  }

  const normalizedNodes = nodes
    .map((node): RootlineCodeGraphNode => {
      const normalized: RootlineCodeGraphNode = {
        id: contentId("graph_node", ["graphify", graphId, "node", node.id]),
        externalId: node.id,
        kind: node.kind,
        label: node.name,
        provenance: node.provenance,
      }
      if (node.location !== undefined) normalized.location = node.location
      return normalized
    })
    .sort((left, right) => compareStrings(left.externalId, right.externalId))

  const nodeIdByExternalId = new Map(
    normalizedNodes.map((node) => [node.externalId, node.id] as const),
  )
  const normalizedLinks = relations
    .map((relation): RootlineCodeGraphLink => {
      const normalized: RootlineCodeGraphLink = {
        id: contentId("graph_link", ["graphify", graphId, "relation", relation.id]),
        externalId: relation.id,
        type: relation.type,
        fromNodeId: nodeIdByExternalId.get(relation.from) as string,
        toNodeId: nodeIdByExternalId.get(relation.to) as string,
        fromExternalId: relation.from,
        toExternalId: relation.to,
        provenance: relation.provenance,
      }
      if (relation.location !== undefined) normalized.location = relation.location
      return normalized
    })
    .sort((left, right) => compareStrings(left.externalId, right.externalId))

  const snapshotContent = {
    schemaVersion: ROOTLINE_CODE_GRAPH_SCHEMA_VERSION,
    source: {
      provider: "graphify" as const,
      graphId,
      schemaVersion: GRAPHIFY_SCHEMA_VERSION,
    },
    nodes: normalizedNodes,
    links: normalizedLinks,
  }

  return {
    ok: true,
    snapshot: {
      id: contentId("graph_snapshot", snapshotContent),
      ...snapshotContent,
    },
  }
}
