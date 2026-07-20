import { createHash } from "node:crypto"

import type { EvaluationReport, ScoreName } from "./model"

const scoreNames: ScoreName[] = [
  "incidentDetection",
  "evidenceSufficiency",
  "nextAction",
  "approvalPolicy",
  "deliverySafety",
]

const implementationSources = [
  ["fixtures.ts", new URL("./fixtures.ts", import.meta.url)],
  ["model.ts", new URL("./model.ts", import.meta.url)],
  ["scorer.ts", new URL("./scorer.ts", import.meta.url)],
] as const

export interface EvaluationAggregateBaseline {
  schemaVersion: 1
  artifactKind: "reviewed_aggregate_baseline"
  evaluationKind: "deterministic_reference"
  modelBacked: false
  suite: "podo-reaction-matrix"
  fixtureAdapterVersion: 2
  scenarioFingerprint: string
  implementationFingerprint: string
  aggregate: {
    status: "passed" | "failed"
    summary: EvaluationReport["summary"]
    metrics: EvaluationReport["metrics"]
    contractErrorCount: number
  }
}

export function aggregateBaseline(
  report: EvaluationReport,
  implementationFingerprint: string,
): EvaluationAggregateBaseline {
  return {
    schemaVersion: 1,
    artifactKind: "reviewed_aggregate_baseline",
    evaluationKind: "deterministic_reference",
    modelBacked: false,
    suite: report.suite,
    fixtureAdapterVersion: report.fixtureAdapterVersion,
    scenarioFingerprint: report.scenarioFingerprint,
    implementationFingerprint,
    aggregate: {
      status: report.status,
      summary: { ...report.summary },
      metrics: { ...report.metrics },
      contractErrorCount: report.contractErrors.length,
    },
  }
}

export async function verifyAggregateBaseline(
  report: EvaluationReport,
  path: string,
  implementationFingerprint: string,
): Promise<void> {
  const baseline = await loadAggregateBaseline(path)
  if (canonicalJson(baseline) !== canonicalJson(aggregateBaseline(report, implementationFingerprint))) {
    throw new Error("eval_baseline_drift")
  }
}

export async function referenceImplementationFingerprint(): Promise<string> {
  const hash = createHash("sha256")
  for (const [name, url] of implementationSources) {
    const bytes = new Uint8Array(await Bun.file(url).arrayBuffer())
    hash.update(name)
    hash.update("\0")
    hash.update(String(bytes.byteLength))
    hash.update("\0")
    hash.update(bytes)
  }
  return `sha256:${hash.digest("hex")}`
}

export async function loadAggregateBaseline(path: string): Promise<EvaluationAggregateBaseline> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) throw new Error("missing")
    return parseAggregateBaseline(await file.json())
  } catch (error) {
    if (error instanceof Error && error.message === "eval_baseline_drift") throw error
    throw new Error("invalid_eval_baseline")
  }
}

export function parseAggregateBaseline(value: unknown): EvaluationAggregateBaseline {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "artifactKind",
      "evaluationKind",
      "modelBacked",
      "suite",
      "fixtureAdapterVersion",
      "scenarioFingerprint",
      "implementationFingerprint",
      "aggregate",
    ])
    || value.schemaVersion !== 1
    || value.artifactKind !== "reviewed_aggregate_baseline"
    || value.evaluationKind !== "deterministic_reference"
    || value.modelBacked !== false
    || value.suite !== "podo-reaction-matrix"
    || value.fixtureAdapterVersion !== 2
    || typeof value.scenarioFingerprint !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.scenarioFingerprint)
    || typeof value.implementationFingerprint !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(value.implementationFingerprint)
    || !isAggregate(value.aggregate)) {
    throw new Error("invalid_eval_baseline")
  }
  return structuredClone(value) as unknown as EvaluationAggregateBaseline
}

function isAggregate(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ["status", "summary", "metrics", "contractErrorCount"])
    || (value.status !== "passed" && value.status !== "failed")
    || !isNonNegativeInteger(value.contractErrorCount)
    || !isSummary(value.summary)
    || !isMetrics(value.metrics)) return false
  return true
}

function isSummary(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "caseCount",
      "passedCases",
      "failedCases",
      "hardFailureCount",
      "score",
    ])
    && isNonNegativeInteger(value.caseCount)
    && isNonNegativeInteger(value.passedCases)
    && isNonNegativeInteger(value.failedCases)
    && isNonNegativeInteger(value.hardFailureCount)
    && isUnitScore(value.score)
    && value.passedCases + value.failedCases === value.caseCount
}

function isMetrics(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, scoreNames)
    && scoreNames.every((name) => isUnitScore(value[name]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",")
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isUnitScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
