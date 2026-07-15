import { open, realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  GRAPHIFY_NETWORKX_DECODER_VERSION,
  decodeGraphifyNetworkxV1,
} from "@podo/plugin-graphify"

import type { IncidentGraphConfig } from "../modules/graph/incident-causal-path"

type Environment = Readonly<Record<string, string | undefined>>
type JsonReader = (url: URL, maxBytes: number) => Promise<unknown>

const BOOTSTRAP_SCHEMA_VERSION = "podo.graph-bootstrap.v1"
const MAX_BOOTSTRAP_BYTES = 64 * 1024
const MAX_GRAPH_BYTES = 16 * 1024 * 1024
const MAX_CORRELATIONS = 1_000
const MAX_IDENTITY_LENGTH = 512
const MAX_PATH_LENGTH = 4_096

interface ChangedFileSelector {
  label: string
  path: string
}

interface TrustedCorrelationConfig {
  deploymentId: string
  containerId: string
  commitSha: string
  changedFile: ChangedFileSelector
}

interface IncidentGraphBootstrapConfig {
  schemaVersion: typeof BOOTSTRAP_SCHEMA_VERSION
  graphId: string
  decoder: typeof GRAPHIFY_NETWORKX_DECODER_VERSION
  fixture: string
  trustedCorrelations: TrustedCorrelationConfig[]
}

export interface ProductionIncidentGraphDependencies {
  readJson?: JsonReader
}

export class ProductionIncidentGraphConfigError extends Error {
  readonly code = "invalid_production_incident_graph_config"

  constructor() {
    super("invalid_production_incident_graph_config")
    this.name = "ProductionIncidentGraphConfigError"
  }
}

export async function loadProductionIncidentGraph(
  environment: Environment,
  dependencies: ProductionIncidentGraphDependencies = {},
): Promise<IncidentGraphConfig | undefined> {
  const enabled = environment.PODO_INCIDENT_GRAPH_ENABLED
  if (enabled === undefined || enabled === "false") return undefined
  if (enabled !== "true") throw invalidConfig()

  const readJson = dependencies.readJson ?? readJsonFile

  try {
    const bootstrapUrl = await resolveBootstrapUrl(environment.PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH)
    const bootstrap = parseBootstrap(await readJson(bootstrapUrl, MAX_BOOTSTRAP_BYTES))
    const graphUrl = await resolveFixtureUrl(bootstrapUrl, bootstrap.fixture)
    const decoded = decodeGraphifyNetworkxV1(await readJson(graphUrl, MAX_GRAPH_BYTES), {
      graphId: bootstrap.graphId,
    })
    if (!decoded.ok) throw invalidConfig()

    const trustedCorrelations = bootstrap.trustedCorrelations.map((correlation) => {
      const matches = decoded.snapshot.nodes.filter((node) =>
        node.kind === "file"
        && node.label === correlation.changedFile.label
        && node.location?.path === correlation.changedFile.path
      )
      if (matches.length !== 1) throw invalidConfig()
      return {
        deploymentId: correlation.deploymentId,
        containerId: correlation.containerId,
        commitSha: correlation.commitSha,
        changedFileNodeId: matches[0]!.id,
      }
    })

    return {
      codeGraph: decoded.snapshot,
      trustedCorrelations,
    }
  } catch {
    throw invalidConfig()
  }
}

async function resolveBootstrapUrl(configuredPath: string | undefined): Promise<URL> {
  if (configuredPath === undefined) throw invalidConfig()
  if (!safeAbsolutePath(configuredPath)) throw invalidConfig()
  return pathToFileURL(await realpath(configuredPath))
}

async function resolveFixtureUrl(bootstrapUrl: URL, fixture: string): Promise<URL> {
  if (bootstrapUrl.protocol !== "file:" || !safeRelativePath(fixture)) throw invalidConfig()
  const bootstrapPath = fileURLToPath(bootstrapUrl)
  const root = dirname(bootstrapPath)
  const fixturePath = await realpath(resolve(root, fixture))
  const fromRoot = relative(root, fixturePath)
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw invalidConfig()
  }
  return pathToFileURL(fixturePath)
}

async function readJsonFile(url: URL, maxBytes: number): Promise<unknown> {
  const handle = await open(url, "r")
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > maxBytes) throw invalidConfig()
    const contents = await handle.readFile()
    if (contents.byteLength > maxBytes) throw invalidConfig()
    return JSON.parse(contents.toString("utf8")) as unknown
  } finally {
    await handle.close()
  }
}

function parseBootstrap(value: unknown): IncidentGraphBootstrapConfig {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion",
    "graphId",
    "decoder",
    "fixture",
    "trustedCorrelations",
  ])) throw invalidConfig()
  if (value.schemaVersion !== BOOTSTRAP_SCHEMA_VERSION
    || value.decoder !== GRAPHIFY_NETWORKX_DECODER_VERSION
    || !isIdentity(value.graphId)
    || !safeRelativePath(value.fixture)
    || !Array.isArray(value.trustedCorrelations)
    || value.trustedCorrelations.length === 0
    || value.trustedCorrelations.length > MAX_CORRELATIONS) throw invalidConfig()

  const trustedCorrelations = value.trustedCorrelations.map(parseTrustedCorrelation)
  const deployments = new Set<string>()
  for (const correlation of trustedCorrelations) {
    if (deployments.has(correlation.deploymentId)) throw invalidConfig()
    deployments.add(correlation.deploymentId)
  }

  return {
    schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
    graphId: value.graphId,
    decoder: GRAPHIFY_NETWORKX_DECODER_VERSION,
    fixture: value.fixture,
    trustedCorrelations,
  }
}

function parseTrustedCorrelation(value: unknown): TrustedCorrelationConfig {
  if (!isRecord(value) || !hasExactKeys(value, [
    "deploymentId",
    "containerId",
    "commitSha",
    "changedFile",
  ])) throw invalidConfig()
  if (!isIdentity(value.deploymentId)
    || !isIdentity(value.containerId)
    || typeof value.commitSha !== "string"
    || !/^[a-f0-9]{40}$/.test(value.commitSha)
    || !isRecord(value.changedFile)
    || !hasExactKeys(value.changedFile, ["label", "path"])
    || !isIdentity(value.changedFile.label)
    || !safeRelativePath(value.changedFile.path)) throw invalidConfig()

  return {
    deploymentId: value.deploymentId,
    containerId: value.containerId,
    commitSha: value.commitSha,
    changedFile: {
      label: value.changedFile.label,
      path: value.changedFile.path,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index])
}

function isIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTITY_LENGTH
    && value === value.trim()
    && !value.includes("\0")
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string"
    || !isIdentity(value)
    || value.length > MAX_PATH_LENGTH
    || value.includes("\\")
    || /[%?#]/.test(value)
    || isAbsolute(value)) return false
  const segments = value.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function safeAbsolutePath(value: string): boolean {
  return isAbsolute(value)
    && value.length <= MAX_PATH_LENGTH
    && resolve(value) === value
    && value === value.trim()
    && !value.includes("\0")
}

function invalidConfig(): ProductionIncidentGraphConfigError {
  return new ProductionIncidentGraphConfigError()
}
